import {validBridgeSecret,verifyBridgeRequest} from '../../../workers/ms-production-bridge-auth.js';
import {createStockPrecheck} from './order-stock-precheck.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev',PATH='/api/orders/scheduled-fulfillment';
const reply=(status,data)=>new Response(JSON.stringify({changedMoySkladRecords:0,...data}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
// Only the server selects a current order. No caller-provided identity or arbitrary scope.
export const NEXT_SQL=`SELECT q.order_key FROM office_order_queue q
 JOIN office_order_queue_sync s ON s.source=q.source AND s.last_success_at=q.source_checked_at
 JOIN office_order_warehouse_routes w ON w.source=q.source AND w.seller_account=q.account
 LEFT JOIN office_order_fulfillment f ON f.order_key=q.order_key
 WHERE ((q.source='ozon' AND q.account='171189' AND q.source_status='awaiting_packaging')
 OR (q.source='yandex' AND q.account='149082506' AND q.source_status IN ('PROCESSING','PENDING','RESERVED'))
 OR (q.source='wb' AND q.source_status IN ('new_fbs_assembly_order','wb_confirmed_assembly')))
 AND json_array_length(q.items_json)=1
 AND EXISTS(SELECT 1 FROM json_each(q.items_json) i JOIN office_order_sku_links l ON l.source=q.source AND l.seller_account=q.account AND l.marketplace_sku=json_extract(i.value,'$.sku') WHERE NOT(q.source='wb' AND json_extract(i.value,'$.sku') IN ('Пламя1','пламя1')))
 AND (f.order_key IS NULL OR f.source_checked_at<>q.source_checked_at OR f.checked_at<? OR EXISTS(SELECT 1 FROM json_each(f.result_json,'$.lines') line WHERE json_extract(line.value,'$.occupancy.reason')='checkpoint_pending' OR json_extract(line.value,'$.production.reason')='checkpoint_pending'))
 ORDER BY CASE WHEN f.source_checked_at=q.source_checked_at AND f.checked_at>=? AND EXISTS(SELECT 1 FROM json_each(f.result_json,'$.lines') line WHERE json_extract(line.value,'$.occupancy.reason')='checkpoint_pending' OR json_extract(line.value,'$.production.reason')='checkpoint_pending') THEN 0 ELSE 1 END, f.checked_at ASC,q.order_key LIMIT 1`;
export function createScheduledFulfillment({now=Date.now,makePrecheck=createStockPrecheck}={}){
 return async({request,env})=>{
  if(request.method!=='POST')return reply(405,{code:'method_not_allowed'});
  const u=new URL(request.url);
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.search||u.hash)return reply(400,{code:'invalid_scope'});
  if(!validBridgeSecret(env?.MS_SALES_BRIDGE_SECRET)||!env.OZON_FINANCE_DB)return reply(503,{code:'scheduled_fulfillment_not_configured'});
  let verified=false;try{verified=await verifyBridgeRequest(env.MS_SALES_BRIDGE_SECRET,request.headers.get('X-MS-Bridge-Time'),request.headers.get('X-MS-Bridge-Signature'),PATH,now());}catch{}
  if(!verified)return reply(401,{code:'unauthorized'});
  if(env.MS_FULFILLMENT_AUTO_SCAN!=='enabled')return reply(503,{code:'scheduled_fulfillment_disabled'});
  try{
   const cutoff=new Date(now()-15*60000).toISOString();
   const row=await env.OZON_FINANCE_DB.prepare(NEXT_SQL).bind(cutoff,cutoff).first();
   if(!row)return reply(200,{code:'scheduled_fulfillment_idle'});
   const internal=new Request(ORIGIN+'/api/orders/order-stock-precheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderKey:row.order_key})});
   const handler=makePrecheck({authorizeServer:async candidate=>candidate===internal});
   const res=await handler({request:internal,env});
   if(!res.ok)return reply(503,{code:'scheduled_fulfillment_unverified'});
   const data=await res.json();
   if(data.code!=='order_stock_precheck'||data.changedMoySkladRecords!==0||data.reviewStored!==true)return reply(503,{code:'scheduled_fulfillment_unverified'});
   return reply(200,{code:'scheduled_fulfillment_checked'});
  }catch{return reply(503,{code:'scheduled_fulfillment_failed'});}
 };
}
export const onRequest=createScheduledFulfillment();
