import {verifySession} from '../auth/session.js';
import {classifyOrderBucket} from './order-buckets.js';

// Only owner can record preliminary order review. No stock, sewing, packing,
// marking, shipment, or MoySklad accounting action is authorized here.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/workflow-review';
const TYPES=new Set(['start_review','mark_reviewed','request_stock_check','hold','resume_review']);
const LIMIT=160;
const reply=(status,x)=>new Response(JSON.stringify(x),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const nextState=(prev,action)=>{
 const transitions={
  pending_review:{start_review:'pending_review',mark_reviewed:'reviewed',hold:'on_hold'},
  reviewed:{request_stock_check:'stock_check_requested',hold:'on_hold'},
  stock_check_requested:{hold:'on_hold'},
  on_hold:{resume_review:'pending_review'}
 };
 return transitions[prev]?.[action]||null;
};
export {nextState};
const keyOk=k=>typeof k==='string'&&k.length>0&&k.length<=180&&
 k.startsWith('AS63:')&&!/[\u0000-\u001f\u007f]/.test(k);
export function createWorkflowReview(){
 return async({request,env})=>{
  if(!['GET','POST'].includes(request.method))return reply(405,{code:'method_not_allowed'});
  const url=new URL(request.url);
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.search||url.hash)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return reply(401,{code:'owner_session_required'});
  const db=env.OZON_FINANCE_DB;
  try{
   const x=await db.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
    .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(x?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(request.method==='GET'){
   try{
    const [r,history]=await Promise.all([
      db.prepare("SELECT w.order_key,w.workflow_state,w.revision,w.updated_at,w.note FROM office_order_workflow w ORDER BY w.updated_at DESC LIMIT 150").all(),
      db.prepare("SELECT e.order_key,e.from_state,e.to_state,e.revision,e.at FROM office_order_workflow_events e ORDER BY e.id DESC LIMIT 150").all()
    ]);
    if(!Array.isArray(r.results)||!Array.isArray(history.results))throw Error();
    return reply(200,{code:'order_workflow_review_read',readOnly:true,
     rows:r.results,events:history.results,limit:150,
     stageScope:'owner_preliminary_review_only',fulfillmentEnabled:false});
   }catch{return reply(503,{code:'workflow_storage_unavailable',
    migration:'20261125_order_workflow_review.sql'});}
  }
  if(request.headers.get('Origin')!==ORIGIN||
   request.headers.get('Sec-Fetch-Site')==='cross-site')
   return reply(403,{code:'origin_not_allowed'});
  let data;
  try{
   if(Number(request.headers.get('Content-Length'))>1000)throw Error();
   data=await request.json();
   if(!data||typeof data!=='object'||Object.keys(data).sort().join(',')!=='action,expectedRevision,orderKey'||
    !TYPES.has(data.action)||!keyOk(data.orderKey)||
    !Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0)throw Error();
  }catch{return reply(400,{code:'invalid_transition_request'});}
  let order,workflow;
  try{
   order=await db.prepare('SELECT order_key,source,source_status,source_checked_at FROM office_order_queue WHERE order_key=? LIMIT 1')
    .bind(data.orderKey).first();
   if(!order)return reply(404,{code:'order_not_found'});
   const bucket=classifyOrderBucket(order);
   if(bucket.bucket!=='active')return reply(409,{code:'order_not_active',
    bucket:bucket.bucket,changedRecords:0});
   const checked=Date.parse(order.source_checked_at);
   if(!Number.isFinite(checked)||Date.now()-checked>24*60*60*1000||
      checked>Date.now()+5*60*1000)
    return reply(409,{code:'source_status_stale',changedRecords:0});
   const sync=await db.prepare(
    'SELECT last_success_at FROM office_order_queue_sync WHERE source=? LIMIT 1')
    .bind(order.source).first();
   if(!sync||sync.last_success_at!==order.source_checked_at)
    return reply(409,{code:'order_not_in_latest_snapshot',changedRecords:0});
   workflow=await db.prepare('SELECT workflow_state,revision FROM office_order_workflow WHERE order_key=? LIMIT 1')
    .bind(data.orderKey).first();
  }catch{return reply(503,{code:'workflow_storage_unavailable',changedRecords:0});}
  const prior=workflow?.workflow_state||'pending_review';
  const revision=workflow?.revision??0;
  if(revision!==data.expectedRevision)return reply(409,{code:'workflow_revision_conflict',
   currentRevision:revision,changedRecords:0});
  const next=nextState(prior,data.action);
  if(!next||next===prior)return reply(409,{code:'workflow_transition_not_allowed',
   currentState:prior,changedRecords:0});
  try{
   let result;
   if(workflow){
    result=await db.prepare(`UPDATE office_order_workflow SET
     workflow_state=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP,
     updated_by_sub=? WHERE order_key=? AND revision=? AND workflow_state=?
     AND EXISTS (SELECT 1 FROM office_order_queue q WHERE q.order_key=?
       AND q.source_status=? AND q.source_checked_at=?)`)
      .bind(next,sub,data.orderKey,revision,prior,
       data.orderKey,order.source_status,order.source_checked_at).run();
   }else{
    result=await db.prepare(`INSERT INTO office_order_workflow
     (order_key,workflow_state,revision,updated_by_sub)
     SELECT order_key,?,1,? FROM office_order_queue
     WHERE order_key=? AND source_status=? AND source_checked_at=?
     AND NOT EXISTS(SELECT 1 FROM office_order_workflow WHERE order_key=?)`)
      .bind(next,sub,data.orderKey,order.source_status,
       order.source_checked_at,data.orderKey).run();
   }
   if(result?.success===false||result?.meta?.changes!==1)
    return reply(409,{code:'workflow_concurrent_change',changedRecords:0});
   return reply(200,{code:'workflow_review_saved',orderKey:data.orderKey,
    workflowState:next,revision:revision+1,changedD1Records:1,
    changedMoySkladRecords:0,fulfillmentEnabled:false});
  }catch{return reply(503,{code:'workflow_storage_unavailable',changedRecords:0});}
 };
}
export const onRequest=createWorkflowReview();
