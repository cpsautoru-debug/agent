import {verifySession} from '../auth/session.js';
import {classifyProductionPlanDate} from '../../../web/office/ms-production-plan-date.mjs';

// Owner-only, read-only automatic production triage sourced from the bounded
// historical scanner. Candidate records are NEVER proof of a live order.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-queue';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX=20;
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'Vary':'Cookie',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const safeNum=v=>Number.isSafeInteger(v)&&v>=0;
const qty=v=>v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9);
const short=(v,max=100)=>v===null||
  (typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v));
const statusOk=v=>v==='incomplete'||v==='unverified';
const parseRow=(row,nowMs)=>{
  if(!row||!UUID.test(row.task_id)||!/^\d{1,10}$/.test(row.number)||
    !statusOk(row.task_stage_status)||!safeNum(row.checked_ms)||
    row.checked_ms>nowMs||!qty(row.remaining_qty)||!qty(row.planned_qty)||
    !short(row.plan_date,40)||!short(row.first_unfinished_stage,100)||
    !safeNum(row.generation))
    throw Error('ms_queue_invalid_source_row');
  const status=row.task_stage_status;
  return {
    taskId:row.task_id.toLowerCase(),number:row.number,status,
    plan:row.planned_qty,remaining:row.remaining_qty,
    firstUnfinishedStage:row.first_unfinished_stage,
    plannedDate:row.plan_date,checkedMs:row.checked_ms,
    sourceGeneration:row.generation,
    plannedDateControl:classifyProductionPlanDate(
      {plannedDate:row.plan_date},{status},nowMs),
    liveVerified:false,orderStatusVerified:false
  };
};
export function assembleQueue(runtime,baselineCount,currentCount,counts,rows,nowMs){
  if(!runtime||!safeNum(runtime.generation)||runtime.generation===0||
    !safeNum(runtime.next_offset)||!safeNum(runtime.total_first_seen)||
    !safeNum(runtime.last_success_ms)||!safeNum(nowMs)||
    !['scanning','pass_complete','paused','error'].includes(runtime.run_status)||
    !safeNum(currentCount)||currentCount!==runtime.next_offset||
    currentCount>runtime.total_first_seen||!safeNum(baselineCount)||
    !counts||!safeNum(counts.incomplete)||!safeNum(counts.unverified)||
    !Array.isArray(rows)||rows.length>MAX*2)
    throw Error('ms_queue_unverified');
  const completed=runtime.run_status==='pass_complete'&&
    currentCount===runtime.total_first_seen;
  const baselineVerified=!completed&&runtime.generation>1&&
    baselineCount===runtime.total_first_seen;
  // Previous-generation records are used only when the current scan is
  // incomplete AND its immediately previous full pass is supported.
  if(!completed&&!baselineVerified)
    return {code:'ms_production_queue_baseline_missing',readOnly:true,
      approvedForDispatch:false,reason:'NO_CONFIRMED_HISTORICAL_COVERAGE'};
  const seen=new Set();
  const items=rows.map(row=>{
    const item=parseRow(row,nowMs);
    if(seen.has(item.taskId))throw Error('ms_queue_duplicate');
    seen.add(item.taskId);return item;
  });
  const freshnessMs=nowMs-runtime.last_success_ms;
  const healthy=freshnessMs>=0&&freshnessMs<=20*60*1000;
  return {
    code:'ms_production_queue_candidates_ok',
    readOnly:true,changedRecords:0,approvedForDispatch:false,
    scope:'HISTORICAL_CANDIDATES_NEED_LIVE_STAGE_AND_ORDER_VERIFICATION',
    generation:runtime.generation,
    baselineGeneration:completed?runtime.generation:runtime.generation-1,
    completeHistoricalCoverage:true,
    inProgress:!completed,
    scanned:currentCount,totalAtStart:runtime.total_first_seen,
    lastSuccessMs:runtime.last_success_ms,monitorHealthy:healthy,
    counts,items,shown:items.length,
    additionalCandidatesNotShown:Math.max(0,counts.incomplete+counts.unverified-items.length),
    sampledAt:new Date(nowMs).toISOString()
  };
}
export function createProductionQueueHandler({now=Date.now}={}){
  return async ({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let url;
    try{url=new URL(request.url);}catch{return json(400,{code:'invalid_queue_scope'});}
    if(url.origin!==ORIGIN||url.pathname!==PATH||url.search||url.hash)
      return json(400,{code:'invalid_queue_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env?.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    let sub;
    try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return json(401,{code:'owner_session_required'});}
    if(!sub)return json(401,{code:'owner_session_required'});
    try{
      const allowed=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(allowed?.allowed!==1)return json(403,{code:'owner_only'});
    }catch{return json(503,{code:'owner_auth_unavailable'});}
    if(!env.MS_PRODUCTION_DB)return json(503,{code:'ms_queue_storage_unavailable'});
    try{
      const db=env.MS_PRODUCTION_DB;
      const runtime=await db.prepare(
        'SELECT generation,next_offset,total_first_seen,run_status,last_success_ms FROM ms_production_auto_runtime WHERE id=1'
      ).first();
      if(!runtime||!safeNum(runtime.generation)||!safeNum(runtime.next_offset)||
        !safeNum(runtime.total_first_seen))
        return json(503,{code:'ms_queue_runtime_unavailable'});
      const current=await db.prepare(
        'SELECT COUNT(*) AS n FROM ms_production_auto_tasks WHERE generation=?'
      ).bind(runtime.generation).first();
      const baseline=await db.prepare(
        'SELECT COUNT(*) AS n FROM ms_production_auto_tasks WHERE generation=?'
      ).bind(runtime.generation-1).first();
      if(!safeNum(current?.n)||!safeNum(baseline?.n))
        throw Error('queue_counts_invalid');
      const completed=runtime.run_status==='pass_complete'&&
        current.n===runtime.total_first_seen;
      const previous=!completed&&runtime.generation>1&&
        baseline.n===runtime.total_first_seen;
      if(!completed&&!previous)
        return json(503,{code:'ms_queue_baseline_unverified',readOnly:true});
      const g=runtime.generation,base=completed?g:g-1;
      // Overlay the latest partial scan on the verified previous pass.
      // Include completed rows in ranking so they SUPPRESS old incomplete rows.
      const ranked=(
        'WITH latest AS (SELECT generation,task_id,number,task_stage_status,'+
        'remaining_qty,planned_qty,first_unfinished_stage,plan_date,checked_ms,'+
        'ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY generation DESC) rn '+
        'FROM ms_production_auto_tasks WHERE generation IN (?,?)) '+
        'SELECT * FROM latest WHERE rn=1 AND task_stage_status IN (\'incomplete\',\'unverified\') '+
        'ORDER BY CASE task_stage_status WHEN \'incomplete\' THEN 0 ELSE 1 END,'+
        'CASE WHEN plan_date IS NULL THEN 1 ELSE 0 END,plan_date,number LIMIT 40'
      );
      const totals=(
        'WITH latest AS (SELECT task_id,task_stage_status,'+
        'ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY generation DESC) rn '+
        'FROM ms_production_auto_tasks WHERE generation IN (?,?)) '+
        'SELECT COALESCE(SUM(CASE WHEN rn=1 AND task_stage_status=\'incomplete\' THEN 1 ELSE 0 END),0) incomplete,'+
        'COALESCE(SUM(CASE WHEN rn=1 AND task_stage_status=\'unverified\' THEN 1 ELSE 0 END),0) unverified FROM latest'
      );
      const [results,counts]=await Promise.all([
        db.prepare(ranked).bind(base,g).all(),
        db.prepare(totals).bind(base,g).first()
      ]);
      if(!Array.isArray(results?.results))throw Error('queue_rows_unavailable');
      const summary=assembleQueue(runtime,baseline.n,current.n,counts,
        results.results,now());
      if(summary.code!=='ms_production_queue_candidates_ok')
        return json(503,{code:'ms_queue_baseline_unverified',readOnly:true});
      return json(200,summary);
    }catch{
      return json(503,{code:'ms_production_queue_unavailable',readOnly:true});
    }
  };
}
export const onRequestGet=createProductionQueueHandler();
