import {json,verifyYandexOwner,yandexRequest,listYandexCampaigns,selectedBusiness,mapSafeYandexError}
 from './finance-source.js';
// Owner-only read of catalog product titles for SKU cost reconciliation.
// Never changes Yandex purchasePrice or prints credentials in responses.
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=255&&
 !/[\u0000-\u001f\u007f]/u.test(v);
const kopecks=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&
 Number.isSafeInteger(Math.round(v*100))?Math.round(v*100):null;

export async function onRequestPost({request,env}){
 if(request.method!=='POST')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/yandex/catalog-cost-evidence'||url.search||url.hash)
  return json(400,{code:'invalid_path'});
 if(request.headers.get('Origin')!==url.origin||
    request.headers.get('Sec-Fetch-Site')==='cross-site')
  return json(403,{code:'origin_denied'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 let body;
 try{
  const raw=await request.text();
  if(raw.length>25000)throw Error('invalid');
  body=JSON.parse(raw);
 }catch{return json(400,{code:'invalid_body'});}
 if(!body||Object.keys(body).sort().join(',')!=='offerIds'||
    !Array.isArray(body.offerIds)||body.offerIds.length<1||
    body.offerIds.length>200||
    !body.offerIds.every(text)||
    new Set(body.offerIds).size!==body.offerIds.length)
  return json(400,{code:'invalid_offer_ids'});
 try{
  const scope=selectedBusiness(await listYandexCampaigns(env));
  const result=await yandexRequest(env,
   '/v2/businesses/'+scope.businessId+'/offer-mappings',
   {method:'POST',body:{offerIds:body.offerIds}});
  const items=result.result?.offerMappings;
  if(!Array.isArray(items)||items.length>200)
   throw Error('yandex_catalog_structure_invalid');
  const allowed=new Set(body.offerIds),found=new Set(),products=[];
  for(const entry of items){
   const offer=entry?.offer,id=offer?.offerId;
   if(!text(id)||!allowed.has(id)||found.has(id))
    throw Error('yandex_catalog_structure_invalid');
   found.add(id);
   const purchase=offer.purchasePrice;
   products.push({shopSku:id,
    name:typeof offer.name==='string'?offer.name.slice(0,250):'',
    // These are catalog input fields only: NOT owner-confirmed costs.
    catalogPurchasePriceKopecks:purchase?.currencyId==='RUR'?
      kopecks(purchase.value):null});
  }
  return json(200,{code:'yandex_catalog_cost_evidence',
   readOnly:true,changedRecords:0,
   products,missingOfferIds:body.offerIds.filter(x=>!found.has(x)),
   source:'YANDEX_BUSINESS_OFFER_MAPPINGS',
   costStatus:'catalog_purchase_price_not_owner_verified'});
 }catch(e){
  const code=e?.message==='yandex_catalog_structure_invalid'?
   e.message:mapSafeYandexError(e);
  return json(503,{code});
 }
}
