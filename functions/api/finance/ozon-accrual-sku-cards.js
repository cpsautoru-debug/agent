import {verifySession} from '../auth/session.js';
import {validateOzonSellerProductInfo} from '../../../web/office/finance-ozon-sku-lookup-core.mjs';
import {ownerCoverCostFromTitle} from '../../../web/office/owner-unit-costs.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
 'Vary':'Cookie, Origin'};
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const MISSING="SELECT a.sku,MAX(a.seller_article) AS article,COUNT(*) AS operation_rows FROM ozon_accruals a LEFT JOIN ozon_cost_entries c ON c.sku=a.sku WHERE a.sku IS NOT NULL AND a.sku<>'' AND c.sku IS NULL GROUP BY a.sku ORDER BY operation_rows DESC LIMIT 101";
export function createOzonAccrualSkuLookup({fetchUpstream=fetch,now=Date.now}={}){
 return async function({request,env}){
  if(!['GET','POST'].includes(request.method))return respond(405,{code:'method_not_allowed'});
  const saving=request.method==='POST';
  if(saving){
   if(request.headers.get('Origin')!==new URL(request.url).origin)
    return respond(403,{code:'origin_denied'});
   if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')
    return respond(415,{code:'content_type_required'});
   let input;try{input=await request.json();}catch{return respond(400,{code:'invalid_body'});}
   if(!input||Object.keys(input).length!==1||input.action!=='sync_preliminary')
    return respond(400,{code:'invalid_action'});
  }
  if(new URL(request.url).search)return respond(400,{code:'invalid_scope'});
  if(!env?.OZON_FINANCE_DB||!env.OFFICE_SESSION_SECRET||
     !env.OFFICE_ALLOWED_EMAIL)return respond(503,{code:'configuration_unavailable'});
  try{
   const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
   if(!actor)return respond(401,{code:'unauthorized'});
   const owner=await env.OZON_FINANCE_DB.prepare(OWNER).bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return respond(403,{code:'forbidden'});
   if(!env.OZON_CLIENT_ID||!env.OZON_API_KEY)
    return respond(503,{code:'ozon_seller_credentials_missing'});
   const result=await env.OZON_FINANCE_DB.prepare(MISSING).all();
   const rows=result?.results;
   if(!Array.isArray(rows)||rows.length>100)return respond(503,{code:'sku_limit_exceeded'});
   const skus=rows.map(x=>String(x.sku));
   if(skus.some(x=>!/^\d{1,18}$/.test(x))||new Set(skus).size!==skus.length)
    return respond(503,{code:'invalid_sku_catalog'});
   if(skus.length===0)return respond(200,{code:'ozon_accrual_sku_cards',readOnly:!saving,
    changedRecords:0,source:'OZON_SELLER_API_CURRENT',foundCount:0,
    missingCount:0,items:[],notFound:[],asOfMs:now()});
   let upstream;
   try{upstream=await fetchUpstream('https://api-seller.ozon.ru/v3/product/info/list',{
    method:'POST',headers:{'Client-Id':env.OZON_CLIENT_ID,
     'Api-Key':env.OZON_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({sku:skus}),signal:AbortSignal.timeout(15000)
   });}catch{return respond(503,{code:'seller_api_network_error'});}
   if(upstream.status===429)return respond(429,{code:'seller_api_rate_limit'});
   if(!upstream.ok)return respond(503,{code:upstream.status===401||upstream.status===403?
    'seller_api_credentials_rejected':'seller_api_upstream_error'});
   let data;try{data=await upstream.json();}catch{return respond(503,{code:'seller_api_invalid_json'});}
   const normalized=validateOzonSellerProductInfo(data,skus);
   const rowMap=new Map(rows.map(x=>[String(x.sku),x]));
   const items=normalized.items.map(x=>{
    const sourceRow=rowMap.get(x.sku);
    // The owner-approved model cost is a review candidate, never certified SKU COGS.
    const reference=ownerCoverCostFromTitle(x.name);
    return {...x,ledgerArticle:sourceRow?.article??null,
     operationRows:sourceRow?.operation_rows??0,
     referenceCostKopecks:reference?.costKopecks??null,
     referenceModel:reference?.category??null,priceStatus:'candidate_not_applied',
     historicalCostVerified:false};
   });
   let changedRecords=0,skipped=0;
   if(saving){
    // Insert only preliminary prices: a current catalog title is never
    // evidence of identical physical composition at each historical sale.
    const insert=env.OZON_FINANCE_DB.prepare(
     "INSERT INTO ozon_cost_entries(sku,seller_article,model,cost_kopecks,status,source,updated_at) "+
     "SELECT ?,?,?,?,'preliminary','OWNER_MODEL_NORM_OZON_SELLER_API_2026_11_25',CURRENT_TIMESTAMP "+
     "WHERE NOT EXISTS(SELECT 1 FROM ozon_cost_entries WHERE sku=?)"
    );
    for(const item of items){
     const cost=item.referenceCostKopecks;
     const row=rowMap.get(item.sku);
     // Require exact offer_id/Seller article agreement. Unverified,
     // renamed, ambiguous or special-variant items stay in the review list.
     if(!Number.isSafeInteger(cost)||cost<=0||
        !row||item.offerId!==row.article||
        /подлокот|премиум|premium|комплект.*\u0434\u043e\u043f/i.test(item.name)){
       skipped++;continue;
     }
     const result=await insert.bind(item.sku,row.article,item.referenceModel,
       cost,item.sku).run();
     const count=result?.meta?.changes;
     if(!Number.isSafeInteger(count)||count<0||count>1)
      throw Error('write_unverified');
     changedRecords+=count;
    }
   }
   return respond(200,{code:'ozon_accrual_sku_cards',readOnly:!saving,changedRecords,skipped,
    source:'OZON_SELLER_API_CURRENT',missingCount:rows.length,
    foundCount:items.length,items,notFound:normalized.notFound,asOfMs:now(),
    profitVerified:false,
    warning:'Current Seller API cards do not establish product identity at transaction date or confirmed COGS.'});
  }catch{return respond(503,{code:'ozon_accrual_sku_lookup_unavailable'});}
 };
}
export const onRequestGet=createOzonAccrualSkuLookup();
