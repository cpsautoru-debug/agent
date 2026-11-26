import {cleanOrderFacts,cleanLineFacts} from './ms-sales-facts.mjs';
import {readSalesDirectories,salesDirectoryEvidence} from './ms-sales-snapshot.mjs';
import {verifySession} from '../auth/session.js';
import {classifyOrderBucket} from './order-buckets.js';
import {scanMoyskladOrderKeys} from '../marketplace/order-import-preview.js';

const ORIGIN='https://autosklad63-office-staging.pages.dev';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status,data)=>new Response(JSON.stringify({readOnly:true,approvedForWrite:false,changedMoySkladRecords:0,...data}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'}});
export function assessSalesReadiness(order,route,links,latest,duplicate,now=Date.now(),counterparty=null){
 const blockers=[];
 if(!['ozon','wb','yandex'].includes(order.source)||classifyOrderBucket(order).bucket!=='active'||order.production_disposition!=='candidate_needs_inventory')blockers.push('not_confirmed_fbs_candidate');
 const stamp=Date.parse(order.source_checked_at);
 if(!latest||latest!==order.source_checked_at||!Number.isFinite(stamp)||now-stamp>86400000||stamp>now+300000)blockers.push('stale_snapshot');
 if(!route||!UUID.test(route.store_id||'')||!UUID.test(route.organization_id||'')||route.store_kind==='marketplace')blockers.push('warehouse_route_unverified');
 let items;try{items=JSON.parse(order.items_json);}catch{}
 if(!Array.isArray(items)||!items.length||items.length>50)throw Error('invalid_order_lines');
 const missingSkus=[];
 for(const item of items){
  const matches=links.filter(x=>x.marketplace_sku===item.sku&&UUID.test(x.ms_item_id||'')&&['product','variant','bundle'].includes(x.ms_item_type));
  if(matches.length!==1)missingSkus.push(item.sku);
  if(!Number.isSafeInteger(item.quantity)||item.quantity<1)blockers.push('quantity_unverified');
 }
 if(missingSkus.length)blockers.push('sku_unverified');
 if(duplicate!=='not_found')blockers.push(duplicate==='already_exists'?'existing_document':'duplicate_scan_unverified');
 const facts=items.map(item=>({order:cleanOrderFacts(item.orderTransaction),line:cleanLineFacts(item.transaction)}));
 const transactionFactsPresent=facts.every(f=>f.order?.scheme==='FBS'&&f.order.createdAt&&f.line?.currency==='RUB'&&f.line.amountMinor!==null);
 if(!transactionFactsPresent)blockers.push('source_transaction_date_price_currency_unverified');
 else blockers.push('accounting_price_basis_unverified');
 if(!counterparty?.verified)blockers.push('counterparty_channel_unverified');
 if(counterparty&&(!counterparty.storeVerified||!counterparty.organizationVerified))blockers.push('warehouse_directory_unverified');
 blockers.push('cutover_inventory_unverified');
 return {orderKey:order.order_key,source:order.source,account:order.account,missingSkus:[...new Set(missingSkus)],duplicate,transactionFactsPresent,counterparty:counterparty||null,blockers:[...new Set(blockers)],readyToWrite:false};
}
export function createMsSalesReadiness({fetcher=fetch,now=Date.now}={}){
 return async({request,env})=>{
  const url=new URL(request.url);
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  if(url.origin!==ORIGIN||url.pathname!=='/api/orders/ms-sales-readiness'||url.hash||[...url.searchParams.keys()].join(',')!=='orderKey')return reply(400,{code:'invalid_scope'});
  const key=url.searchParams.get('orderKey');
  if(!/^AS63:(ozon|wb|yandex):[A-Za-z0-9._-]{1,100}:[A-Za-z0-9._-]{1,100}$/.test(key||'')||key.length>180)return reply(400,{code:'invalid_order_key'});
  const db=env?.OZON_FINANCE_DB;
  if(!db||!env.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL)return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return reply(401,{code:'owner_session_required'});
  try{
   const owner=await db.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
   const order=await db.prepare('SELECT order_key,source,account,source_status,production_disposition,source_checked_at,items_json FROM office_order_queue WHERE order_key=? LIMIT 1').bind(key).first();
   if(!order)return reply(404,{code:'order_not_found'});
   const [route,sync,links]=await Promise.all([
    db.prepare('SELECT store_id,organization_id,store_kind FROM office_order_warehouse_routes WHERE source=? AND seller_account=? LIMIT 1').bind(order.source,order.account).first(),
    db.prepare('SELECT last_success_at FROM office_order_queue_sync WHERE source=? LIMIT 1').bind(order.source).first(),
    db.prepare('SELECT marketplace_sku,ms_item_id,ms_item_type FROM office_order_sku_links WHERE source=? AND seller_account=? AND marketplace_sku IN (SELECT json_extract(value,\'$.sku\') FROM json_each(?))').bind(order.source,order.account,order.items_json).all()
   ]);
   let duplicate='unverified';
   if(typeof env.MS_API_TOKEN==='string'&&env.MS_API_TOKEN&&!/\s/.test(env.MS_API_TOKEN)){
    try{const scan=await scanMoyskladOrderKeys(fetcher,env.MS_API_TOKEN,[key]);const count=scan.matches.get(key);
     if(count===1)duplicate='already_exists';
     else if(count===0&&scan.complete&&!scan.sourceError)duplicate='not_found';
    }catch{}
   }
   let counterparty=null;
   try{
    const config=JSON.parse(env.MS_SALES_COUNTERPARTY_MAP||'{}');
    const names=Object.hasOwn(config,order.source+':'+order.account)?config[order.source+':'+order.account]:null;
    counterparty=salesDirectoryEvidence(await readSalesDirectories(env.MS_PRODUCTION_DB,now()),names,route);
   }catch{}
   return reply(200,{code:'ms_sales_readiness',...assessSalesReadiness(order,route,links.results,sync?.last_success_at,duplicate,now(),counterparty)});
  }catch{return reply(503,{code:'sales_readiness_unavailable'});}
 };
}
export const onRequest=createMsSalesReadiness();
