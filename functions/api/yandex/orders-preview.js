import {yandexLineFacts,iso} from '../orders/ms-sales-facts.mjs';
import {verifyYandexOwner,listYandexCampaigns,selectedBusiness,json,mapSafeYandexError} from './finance-source.js';

// Owner-only, strictly read-only Yandex Market order preview.
// POST is to Yandex's READ endpoint; no MoySklad writes, no buyer data.
const ENDPOINT='https://api.partner.market.yandex.ru';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const CAMPAIGNS=[149082506,149106500];
const MAX_BYTES=256*1024, LIMIT=50, MAX_PAGES=20;
const MAX_ID=999999999999999;
const string=(s,n=100)=>typeof s==='string'&&s.length>0&&s.length<=n&&
 !/[\u0000-\u001f\u007f]/.test(s);
const validId=x=>Number.isSafeInteger(x)&&x>0&&x<=MAX_ID;

export function normalizeYandexOrderPreview(body,allowedCampaignIds){
 const orders=body?.orders;
 if(!body||!['OK',undefined].includes(body.status)||!Array.isArray(orders)||orders.length>LIMIT||
   !Array.isArray(allowedCampaignIds)||allowedCampaignIds.some(x=>!validId(x)))
   throw Error('yandex_orders_response_unverified');
 const seen=new Set();
 const rows=orders.map(o=>{
   if(!validId(o?.orderId)||!allowedCampaignIds.includes(o.campaignId)||
     typeof o.status!=='string'||!string(o.status,60)||
     !['FBY','FBS','DBS','EXPRESS','LAAS'].includes(o.programType)||
     o.fake===true||!Array.isArray(o.items)||!o.items.length||o.items.length>50)
     throw Error('yandex_order_fields_unverified');
   const externalKey='AS63:yandex:'+o.campaignId+':'+o.orderId;
   if(seen.has(externalKey))throw Error('yandex_order_duplicate');
   seen.add(externalKey);
   const items=o.items.map(i=>{
     if(!string(i?.offerId)||!Number.isSafeInteger(i?.count)||
       i.count<1||i.count>1000)throw Error('yandex_order_item_unverified');
     return {sku:i.offerId,quantity:i.count,transaction:yandexLineFacts(i),assortmentMatch:'unverified'};
   });
   const terminal=['DELIVERED','CANCELLED','RETURNED','UNPAID'].includes(o.status);
   const scheme=o.programType;
   // Even FBS must be checked against inventory, buyer cancellations and
   // seller obligations. This preview never approves dispatch.
   const candidate=scheme==='FBS'&&!terminal&&
     o.status==='PROCESSING';
   return {source:'yandex',externalKey,campaignId:o.campaignId,
     status:o.status,programType:scheme,items,transaction:{scheme,createdAt:iso(o.creationDate),updatedAt:iso(o.updateDate)},
     productionQueue:candidate?'candidate_needs_inventory':'not_for_sewing',
     duplicateStatus:'unverified',assortmentVerified:false,
     legalEntityVerified:false,readyToWrite:false};
 });
 return rows;
}
async function readJsonBounded(response){
 const reader=response.body?.getReader();if(!reader)throw Error('yandex_no_body');
 const decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
 try{for(;;){const {done,value}=await reader.read();if(done){text+=decoder.decode();break;}
    size+=value.byteLength;if(size>MAX_BYTES)throw Error('yandex_response_too_large');
    text+=decoder.decode(value,{stream:true});}}
 finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(text);
}
export function createYandexOrdersPreview({fetcher=fetch,campaignLoader=listYandexCampaigns,
 now=Date.now,fromDate=null}={}){
 return async ({request,env})=>{
   if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
   const url=new URL(request.url);
   if(url.origin!==ORIGIN||url.pathname!=='/api/yandex/orders-preview'||
     url.hash||url.search)
     return json(400,{code:'invalid_scope'});
   const auth=await verifyYandexOwner(request,env);
   if(auth)return json(auth.status,{code:auth.code});
   try{
     const all=await campaignLoader(env);
     const selected=all.filter(c=>CAMPAIGNS.includes(c.campaignId));
     if(selected.length!==2||
       new Set(selected.map(x=>x.campaignId)).size!==2||
       new Set(selected.map(x=>x.businessId)).size!==1||
       selectedBusiness(selected).campaignIds.length!==2)
       throw Error('yandex_order_campaign_scope_unverified');
     const businessId=selected[0].businessId;
     const dateOnly=d=>d.toISOString().slice(0,10);
     // creationDateTo is exclusive. Tomorrow includes today's orders.
     // Capture the clock once so every page uses the same date boundaries.
     const clock=now();
     if(!Number.isFinite(clock)||clock<0)throw Error('yandex_orders_clock_invalid');
     const end=new Date(clock);end.setUTCHours(0,0,0,0);
     end.setUTCDate(end.getUTCDate()+1);
     const start=fromDate===null?new Date(end.getTime()-30*86400000):
       new Date(fromDate+'T00:00:00Z');
     if(fromDate!==null&&(fromDate!=='2026-10-01'||dateOnly(start)!==fromDate)||
       start>=end)throw Error('yandex_orders_date_scope_invalid');
     const allOrders=[],seenOrders=new Set();
     let pages=0,complete=true,windowStart=start,windows=0;
     while(windowStart<end){
      const windowEnd=new Date(Math.min(end.getTime(),windowStart.getTime()+30*86400000));
      const seenTokens=new Set();
      let pageToken=null,windowComplete=false;
      for(;pages<MAX_PAGES;){
       const apiUrl=new URL(ENDPOINT+'/v1/businesses/'+businessId+'/orders');
       apiUrl.searchParams.set('limit',String(LIMIT));
       if(pageToken)apiUrl.searchParams.set('pageToken',pageToken);
       const upstream=await fetcher(apiUrl.toString(),{
         method:'POST',redirect:'manual',
         headers:{'Api-Key':env.YANDEX_MARKET_API_KEY,
           Accept:'application/json','Content-Type':'application/json'},
         body:JSON.stringify({campaignIds:CAMPAIGNS,fake:false,
           dates:{creationDateFrom:dateOnly(windowStart),creationDateTo:dateOnly(windowEnd)}}),
         signal:AbortSignal.timeout(15000)
       });
       if(upstream.status!==200){
         await upstream.body?.cancel().catch(()=>{});
         return json(503,{code:upstream.status===401||upstream.status===403?
           'yandex_orders_access_denied':upstream.status===420||upstream.status===429?
           'yandex_orders_rate_limited':'yandex_orders_upstream_error',
           upstreamHttp:upstream.status,readOnly:true,changedRecords:0,
           complete:false,pages});
       }
       const payload=await readJsonBounded(upstream);
       const pageOrders=normalizeYandexOrderPreview(payload,CAMPAIGNS);
       for(const order of pageOrders){
         if(seenOrders.has(order.externalKey))throw Error('yandex_order_duplicate');
         seenOrders.add(order.externalKey);allOrders.push(order);
       }
       const next=payload?.paging?.nextPageToken;
       if(next!==undefined&&(typeof next!=='string'||!next||next.length>500))
         throw Error('yandex_orders_paging_unverified');
       pages++;
       if(!next){windowComplete=true;break;}
       if(seenTokens.has(next))throw Error('yandex_orders_paging_unverified');
       seenTokens.add(next);pageToken=next;
      }
      if(!windowComplete){complete=false;break;}
      windows++;windowStart=windowEnd;
     }
     if(!complete)return json(503,{code:'yandex_orders_page_limit',
       readOnly:true,changedRecords:0,approvedForWrite:false,
       coverage:'INCOMPLETE_PAGE_LIMIT',businessScope:'one_business_two_campaigns',
       campaignIds:CAMPAIGNS,received:allOrders.length,pages,complete:false,
       hasNextPage:true,duplicateScan:'NOT_PERFORMED',itemsMapped:false});
     return json(200,{code:'yandex_orders_preview_ok',
       readOnly:true,changedRecords:0,approvedForWrite:false,
       coverage:fromDate===null?'BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE':
         'BOTH_CAMPAIGNS_SINCE_2026_10_01_COMPLETE',
       allOpenVerified:false,
       scope:{fromDate:dateOnly(start),toDateExclusive:dateOnly(end),windows},
       businessScope:'one_business_two_campaigns',
       campaignIds:CAMPAIGNS,received:allOrders.length,pages,
       hasNextPage:false,complete:true,duplicateScan:'NOT_PERFORMED',
       itemsMapped:false,sampleTime:new Date().toISOString(),orders:allOrders});
   }catch(e){
     const reason=e?.message==='yandex_order_campaign_scope_unverified'?
       'yandex_order_campaign_scope_unverified':
       e?.message?.startsWith('yandex_order')||e?.message?.startsWith('yandex_orders')?
       'yandex_orders_response_unverified':mapSafeYandexError(e);
     return json(503,{code:reason,readOnly:true,changedRecords:0});
   }
 };
}
export const onRequestGet=createYandexOrdersPreview();

