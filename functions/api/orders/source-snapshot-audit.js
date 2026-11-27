import {verifySession} from '../auth/session.js';
import {readWbOrderSnapshot,normalizeMarketplaceOrders} from '../marketplace/order-import-preview.js';
import {createYandexOrdersPreview} from '../yandex/orders-preview.js';
import {sanitizeSourceOrder,validateSourceSnapshot} from './persistent-queue.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev',PATH='/api/orders/source-snapshot-audit';
const COVERAGE={wb:'WB_NEW_AND_30_DAY_FBS_STATUS_SNAPSHOT',yandex:'BOTH_CAMPAIGNS_SINCE_2026_10_01_COMPLETE'};
const reply=(status,data)=>new Response(JSON.stringify({...data,readOnly:true,allOpenVerified:false}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'}});
function itemSignature(items){
 if(!Array.isArray(items)||!items.length)throw Error('invalid_items');
 const totals=new Map();
 for(const x of items){if(typeof x.sku!=='string'||!x.sku||!Number.isSafeInteger(x.quantity)||x.quantity<1)throw Error('invalid_item');totals.set(x.sku,(totals.get(x.sku)||0)+x.quantity);}
 return JSON.stringify([...totals].sort(([a],[b])=>a<b?-1:a>b?1:0));
}
export function compareSnapshots(baseline,live){
 function map(rows){const out=new Map();for(const r of rows){if(typeof r.key!=='string'||!r.key||typeof r.sourceStatus!=='string'||!r.sourceStatus||out.has(r.key))throw Error('invalid_identity');out.set(r.key,{status:r.sourceStatus,items:itemSignature(r.items)});}return out;}
 const a=map(baseline),b=map(live);let onlyLive=0,onlyBaseline=0,statusMismatch=0,itemMismatch=0;
 for(const [key,row] of b){const old=a.get(key);if(!old){onlyLive++;continue;}if(old.status!==row.status)statusMismatch++;if(old.items!==row.items)itemMismatch++;}
 for(const key of a.keys())if(!b.has(key))onlyBaseline++;
 return {baselineCount:a.size,received:b.size,onlyLive,onlyBaseline,statusMismatch,itemMismatch};
}
async function liveRead(source,env,clock){
 if(source==='wb'){
  if(!env.WB_ORDERS_API_TOKEN)throw Error('missing_token');
  return normalizeMarketplaceOrders('wb',await readWbOrderSnapshot(fetch,env.WB_ORDERS_API_TOKEN,clock),'wb-primary').map(o=>sanitizeSourceOrder('wb',o));
 }
 const internal=new Request(ORIGIN+'/api/yandex/orders-preview');
 const handler=createYandexOrdersPreview({now:()=>clock,fromDate:'2026-10-01',authorizeServer:async r=>r===internal});
 const response=await handler({request:internal,env});
 if(!response.ok)throw Error('upstream_unverified');
 const data=await response.json();
 if(data.coverage!==COVERAGE.yandex)throw Error('scope_unverified');
 return validateSourceSnapshot('yandex',data);
}
export function createSourceSnapshotAudit({verify=verifySession,now=Date.now,read=liveRead}={}){
 return async({request,env})=>{
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  const u=new URL(request.url),source=u.searchParams.get('source');
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.hash||!Object.hasOwn(COVERAGE,source)||[...u.searchParams.keys()].join(',')!=='source')return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)return reply(503,{code:'owner_auth_unavailable'});
  let sub;try{sub=await verify(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return reply(401,{code:'owner_session_required'});
  const db=env.OZON_FINANCE_DB;
  try{const owner=await db.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();if(owner?.allowed!==1)return reply(403,{code:'owner_only'});}
  catch{return reply(503,{code:'owner_auth_unavailable'});}
  try{
   const clock=now(),sync=await db.prepare('SELECT last_success_at,coverage,rows_seen FROM office_order_queue_sync WHERE source=?').bind(source).first();
   const age=clock-Date.parse(sync?.last_success_at||'');
   if(!(age>=0&&age<=1800000)||sync.coverage!==COVERAGE[source]||!Number.isSafeInteger(sync.rows_seen)||sync.rows_seen<0||sync.rows_seen>300)return reply(409,{code:'baseline_unverified',source});
   const {results}=await db.prepare('SELECT order_key,source_status,items_json FROM office_order_queue WHERE source=? AND source_checked_at=? LIMIT 301').bind(source,sync.last_success_at).all();
   if(!Array.isArray(results)||results.length!==sync.rows_seen)return reply(409,{code:'baseline_unverified',source});
   const baseline=results.map(r=>({key:r.order_key,sourceStatus:r.source_status,items:JSON.parse(r.items_json)}));
   const live=await read(source,env,clock);
   const comparison=compareSnapshots(baseline,live);
   return reply(200,{code:'bounded_snapshot_recheck_complete',source,coverage:sync.coverage,baselineCheckedAt:sync.last_success_at,checkedAt:new Date(clock).toISOString(),...comparison});
  }catch{return reply(503,{code:'bounded_snapshot_recheck_unavailable',source});}
 };
}
export const onRequest=createSourceSnapshotAudit();
