import {cleanOrderFacts,cleanLineFacts} from './ms-sales-facts.mjs';
import {verifySession} from '../auth/session.js';
import {classifyOrderBucket} from './order-buckets.js';
import {onRequestGet as marketplacePreview} from '../marketplace/order-import-preview.js';
import {createYandexOrdersPreview} from '../yandex/orders-preview.js';
import {onRequestGet as manualPreview} from '../ms/manual-orders-preview.js';
import {readReviews} from './fulfillment-review.mjs';
import {assessMarketplaceCoverage} from './fulfillment-source-coverage.mjs';

// Staging operational mirror, not MoySklad accounting or a dispatch queue.
// Each POST re-fetches from authenticated upstream APIs on the SERVER.
// No user-supplied order details can be written to D1.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/persistent-queue';
const HEADER={'Content-Type':'application/json;charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADER});
const SOURCES=['ozon','ozon_fbo','wb','yandex','manual'];
const MAX_SAVE=150;
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean=(s,n=180)=>typeof s==='string'&&s.length>0&&s.length<=n&&
 !/[\u0000-\u001f\u007f]/.test(s);
const eligible=x=>['candidate_needs_inventory','not_for_sewing','unverified'].includes(x);
const manualKinds=['avito','plamya','dealer_ruslan','dealer_irina'];
// Owner-selected investigation boundary; this is not proof of older absence.
const yandexPreview=createYandexOrdersPreview({fromDate:'2026-10-01'});
export function classifyCurrentOrder(order,latestSync){
 const classification=classifyOrderBucket(order);
 if(!['active','review'].includes(classification.bucket))return classification;
 const source=manualKinds.includes(order.source)?'manual':order.source;
 const latest=latestSync.get(source);
 if(!latest||latest!==order.source_checked_at)
  return {bucket:'review',reason:latest?'not_in_latest_source_snapshot':'source_snapshot_missing',sewingAllowed:false};
 return classification;
}
export function sanitizeSourceOrder(source,order){
 if(source==='manual'){
  if(!order||!manualKinds.includes(order.source)||!ID.test(order.documentId||'')||
    !clean(order.status,100)||!Array.isArray(order.items)||!order.items.length||
    order.items.length>100||order.items.some(p=>!ID.test(p.itemId||'')||
      !['product','variant','bundle'].includes(p.itemType)||
      typeof p.quantity!=='number'||!Number.isFinite(p.quantity)||
      p.quantity<=0||p.quantity>10000))throw Error('invalid_manual_order');
  const id=order.documentId.toLowerCase(),key='AS63:manual:'+order.source+':'+id;
  return {key,source:order.source,account:'moysklad',externalId:id,
   sourceStatus:order.status,disposition:order.statusType==='Unsuccessful'?
    'not_for_sewing':'unverified',msId:id,
   items:order.items.map(p=>({itemId:p.itemId.toLowerCase(),
    itemType:p.itemType,quantity:p.quantity,name:clean(p.name,200)?p.name:null,...(p.transaction?{transaction:cleanLineFacts(p.transaction)}:{}),...(order.transaction?{orderTransaction:cleanOrderFacts(order.transaction)}:{})}))};
 }
 if(!['ozon','ozon_fbo','wb','yandex'].includes(source)||
   order?.source!==source||!clean(order.externalKey,180)||
   !order.externalKey.startsWith('AS63:'+source+':')||
   !clean(order.status,100)||!eligible(order.productionQueue)||
   !Array.isArray(order.items)||!order.items.length||order.items.length>50)
   throw Error('invalid_source_order');
 const parts=order.externalKey.split(':');
 if(parts.length!==4||parts[0]!=='AS63'||parts[1]!==source||
   !/^[a-zA-Z0-9._-]{1,100}$/.test(parts[2])||
   !/^[a-zA-Z0-9._-]{1,100}$/.test(parts[3])||
   order.items.some(p=>!clean(p.sku,100)||!Number.isSafeInteger(p.quantity)||
     p.quantity<1||p.quantity>1000))throw Error('invalid_source_order');
 return {key:order.externalKey,source,account:parts[2],externalId:parts[3],
  sourceStatus:order.status,
  disposition:source==='ozon_fbo'?'not_for_sewing':order.productionQueue,
  msId:null,items:order.items.map(p=>({sku:p.sku,quantity:p.quantity,...(p.transaction?{transaction:cleanLineFacts(p.transaction)}:{}),...(order.transaction?{orderTransaction:cleanOrderFacts(order.transaction)}:{})}))};
}
export function validateSourceSnapshot(source,data){
 if(!SOURCES.includes(source)||!data||data.readOnly!==true||
   data.changedRecords!==0||data.complete!==true||!Array.isArray(data.orders)||
   data.orders.length>MAX_SAVE)throw Error('snapshot_incomplete_or_too_large');
 if(source==='manual'){
  if(data.code!=='manual_orders_preview_ok'||data.duplicateCount!==0||
   !Array.isArray(data.channels)||data.channels.length!==4||
   data.channels.some(c=>c.complete!==true))throw Error('manual_snapshot_unverified');
 }else if(source==='yandex'){
  const history=data.coverage==='BOTH_CAMPAIGNS_SINCE_2026_10_01_COMPLETE'&&
   data.allOpenVerified===false&&data.scope?.fromDate==='2026-10-01'&&
   /^20\d{2}-\d{2}-\d{2}$/.test(data.scope?.toDateExclusive||'')&&
   Number.isSafeInteger(data.scope?.windows)&&data.scope.windows>0&&data.scope.windows<=20;
  if(data.code!=='yandex_orders_preview_ok'||data.approvedForWrite!==false||
   data.hasNextPage!==false||data.received!==data.orders.length||
   !(data.coverage==='BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE'||history))
   throw Error('marketplace_snapshot_unverified');
 }else if(data.code!=='marketplace_order_import_preview_ok'||
  data.approvedForWrite!==false||data.source!==source||
  data.counts?.received!==data.orders.length)
   throw Error('marketplace_snapshot_unverified');
 const orders=data.orders.map(o=>sanitizeSourceOrder(source,o));
 if(new Set(orders.map(o=>o.key)).size!==orders.length)
  throw Error('duplicate_source_identity');
 return orders;
}
async function authenticated(request,env){
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
  return {status:503,code:'owner_auth_unavailable'};
 let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
 if(!sub)return {status:401,code:'owner_session_required'};
 try{
  const p=env.OZON_FINANCE_DB.prepare(
   "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1");
  const row=await p.bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
  return row?.allowed===1?{sub}:{status:403,code:'owner_only'};
 }catch{return {status:503,code:'owner_auth_unavailable'};}
}
function upsertSql(){
 return `INSERT INTO office_order_queue
 (order_key,source,account,external_id,source_status,production_disposition,items_json,ms_customerorder_id,source_checked_at)
 VALUES (?,?,?,?,?,?,?,?,?)
 ON CONFLICT(order_key) DO UPDATE SET
 source_status=excluded.source_status,
 production_disposition=excluded.production_disposition,
 items_json=excluded.items_json,
 source_checked_at=excluded.source_checked_at,
 last_seen_at=CURRENT_TIMESTAMP
 WHERE office_order_queue.source=excluded.source
 AND office_order_queue.account=excluded.account
 AND office_order_queue.external_id=excluded.external_id`;
}
export function createPersistentQueue({
 marketplaceHandler=marketplacePreview,yandexHandler=yandexPreview,
 manualHandler=manualPreview}={}){
 return async({request,env})=>{
  if(!['GET','POST'].includes(request.method))return reply(405,{code:'method_not_allowed'});
  const url=new URL(request.url);
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash)return reply(400,{code:'invalid_scope'});
  const auth=await authenticated(request,env);
  if(!auth.sub)return reply(auth.status,{code:auth.code});
  const db=env.OZON_FINANCE_DB;
  if(request.method==='GET'){
   if(url.search)return reply(400,{code:'invalid_scope'});
   try{
    const [orders,sync]=await Promise.all([
     db.prepare('SELECT order_key,source,account,external_id,source_status,production_disposition,items_json,ms_customerorder_id,workflow_status,source_checked_at,last_seen_at FROM office_order_queue ORDER BY last_seen_at DESC,order_key LIMIT 150').all(),
     db.prepare('SELECT source,last_success_at,coverage,rows_seen,note FROM office_order_queue_sync ORDER BY source').all()
    ]);
    if(!Array.isArray(orders.results)||!Array.isArray(sync.results))throw Error();
    const latestSync=new Map(sync.results.map(row=>[row.source,row.last_success_at]));
    const displayed=orders.results.map(r=>{
     const classification=classifyCurrentOrder(r,latestSync);
     return {...r,items:JSON.parse(r.items_json),items_json:undefined,
      queue_bucket:classification.bucket,queue_reason:classification.reason,
      sewing_allowed:false};
    });
    let fulfillment=[];
    let fulfillmentAvailable=false;
    try{
     const saved=await readReviews(db,displayed.filter(o=>o.queue_bucket==='active').map(o=>o.order_key));
     const active=new Set(displayed.filter(o=>o.queue_bucket==='active').map(o=>o.order_key));
     fulfillment=saved.results.filter(row=>active.has(row.order_key)).map(row=>({
      orderKey:row.order_key,checkedAt:row.checked_at,...JSON.parse(row.result_json)
     }));
     fulfillmentAvailable=true;
    }catch{}
    // Owner-only actionable readiness; absence of evidence is always unknown.
    // Failure to load a mapping must never be interpreted as approval.
    let approvalReadiness=[];
    try{
     const current=displayed.filter(o=>o.queue_bucket==='active').slice(0,30);
     const keys=current.map(order=>order.order_key);
     if(keys.length){
      const {results}=await db.prepare(`SELECT q.order_key,route.store_id,
       line.key AS line_index,link.ms_item_id
       FROM json_each(?) requested
       CROSS JOIN office_order_queue q ON q.order_key=requested.value
       LEFT JOIN office_order_warehouse_routes route
        ON route.source=q.source AND route.seller_account=q.account
       LEFT JOIN json_each(q.items_json) line ON line.key<20
       LEFT JOIN office_order_sku_links link
        ON link.source=q.source AND link.seller_account=q.account
        AND link.marketplace_sku=json_extract(line.value,'$.sku')`).bind(JSON.stringify(keys)).all();
      const byOrder=new Map();
      for(const row of results){
       if(!byOrder.has(row.order_key))byOrder.set(row.order_key,new Map());
       byOrder.get(row.order_key).set(row.line_index,row);
      }
      approvalReadiness=current.map(order=>{
       const evidence=byOrder.get(order.order_key);
       const local=manualKinds.includes(order.source);
       const unapprovedSkus=order.items.slice(0,20).flatMap((item,index)=>
        ID.test((local?item.itemId:evidence?.get(index)?.ms_item_id)||'')?[]:
         [local?(item.name||'itemId'):item.sku]);
       return {orderKey:order.order_key,source:order.source,account:order.account,
        warehouseConfirmed:local?ID.test(order.ms_customerorder_id||''):
         ID.test(evidence?.get(0)?.store_id||''),unapprovedSkus,marketplaceCoverageConfirmed:false};
      });
     }
    }catch{
     approvalReadiness=[]; // never mark an unknown approval as verified
    }
    const counts={active:0,transit:0,history:0,review:0};
    for(const order of displayed)counts[order.queue_bucket]++;
    return reply(200,{code:'persistent_queue_read',readOnly:true,fulfillment,fulfillmentAvailable,
     limit:150,displayedCount:displayed.length,
     bucketCounts:counts,countsScope:'displayed_first_150_only',
     orders:displayed,sources:sync.results,
     coverageDiagnostics:assessMarketplaceCoverage(sync.results),approvalReadiness,
     note:'Source-status classification only; no inventory, physical stock, production or dispatch approval.'});
   }catch{return reply(503,{code:'persistent_queue_storage_unavailable',
    migration:'20261125_persistent_order_queue.sql'});}
  }
  if(url.search||request.headers.get('Origin')!==ORIGIN||
    request.headers.get('Sec-Fetch-Site')==='cross-site')
   return reply(403,{code:'origin_not_allowed'});
  let body;
  try{if(Number(request.headers.get('Content-Length'))>500)throw Error();
   body=await request.json();
   if(!body||Object.keys(body).length!==1||!SOURCES.includes(body.source))throw Error();
  }catch{return reply(400,{code:'invalid_refresh_source'});}
  const source=body.source;
  try{
   const last=await db.prepare('SELECT last_success_at FROM office_order_queue_sync WHERE source=?')
    .bind(source).first();
   const age=Date.now()-Date.parse(last?.last_success_at);
   if(age>=0&&age<60000)
    return reply(200,{code:'persistent_queue_source_reused',source,
     savedSnapshotAt:last.last_success_at,changedRecords:0});
  }catch{return reply(503,{code:'persistent_queue_storage_unavailable',source,changedRecords:0});}
  const path=source==='manual'?'/api/ms/manual-orders-preview':
   source==='yandex'?'/api/yandex/orders-preview':
    '/api/marketplace/order-import-preview?source='+source;
  const forwarded=new Request(ORIGIN+path,{headers:{
   Cookie:request.headers.get('Cookie')||'',Accept:'application/json'
  }});
  let upstream;
  try{
   const handler=source==='manual'?manualHandler:
    source==='yandex'?yandexHandler:marketplaceHandler;
   const response=await handler({request:forwarded,env});
   if(response.status!==200)return reply(503,{code:'source_not_verified',
    source,upstreamStatus:response.status,changedRecords:0});
   upstream=await response.json();
  }catch{return reply(503,{code:'source_not_verified',source,changedRecords:0});}
  return saveSourceSnapshot(db,source,upstream);

 };
}
export const onRequest=createPersistentQueue();


// Shared server-side persistence: only validated upstream snapshots, no accounting writes.
export async function saveSourceSnapshot(db,source,upstream,now=Date.now){
  let orders;
  try{orders=validateSourceSnapshot(source,upstream);}
  catch(e){return reply(503,{code:e.message==='snapshot_incomplete_or_too_large'?
   'snapshot_incomplete_or_too_large':'snapshot_unverified',
   source,changedRecords:0});}
  // D1 batch is transactional. Fail closed if schema has not yet been applied.
  const stamp=new Date(now()).toISOString();
  try{
   const tasks=orders.map(o=>db.prepare(upsertSql()).bind(
    o.key,o.source,o.account,o.externalId,o.sourceStatus,o.disposition,
    JSON.stringify(o.items),o.msId,stamp));
   const coverage=source==='manual'?'MANUAL_MARKED_CUSTOMERORDERS_COMPLETE':
    upstream.coverage||'SOURCE_DEFINED_COVERAGE';
   tasks.push(db.prepare(`INSERT INTO office_order_queue_sync
    (source,last_success_at,coverage,rows_seen,note) VALUES (?,?,?,?,?)
    ON CONFLICT(source) DO UPDATE SET
    last_success_at=excluded.last_success_at,coverage=excluded.coverage,
    rows_seen=excluded.rows_seen,note=excluded.note`).bind(
    source,stamp,String(coverage).slice(0,150),orders.length,
    'Complete only within source scope; not all open orders.'));
   const result=await db.batch(tasks);
   if(!Array.isArray(result)||result.length!==tasks.length||
     result.some(r=>r?.success===false))throw Error('batch_not_verified');
   return reply(200,{code:'persistent_queue_source_saved',source,received:orders.length,
    savedSnapshotAt:stamp,coverage,changedAccountingRecords:0,
    changedMoySkladRecords:0,workflowStatus:'unverified',
    note:'Stored source mirror only. No stock allocation, production task, or shipment.'});
  }catch{return reply(503,{code:'persistent_queue_storage_unavailable',
   source,changedRecords:0,migration:'20261125_persistent_order_queue.sql'});}
}
