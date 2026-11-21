import {verifySession} from '../auth/session.js';
import {classifyProductionPlanDate} from '../../../web/office/ms-production-plan-date.mjs';

// Read-only summary of a DEDICATED staging production monitor D1.
// The scan is historical and non-atomic; it is NOT a list of all active orders.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-auto-status';
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'Vary':'Cookie',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const STATUS=new Set(['new','scanning','pass_complete','paused','error']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short=(str,len=110)=>typeof str==='string'&&str.length<=len&&
  !/[\u0000-\u001f\u007f]/u.test(str)?str:null;
const int=(v)=>Number.isSafeInteger(v)&&v>=0;
const finite=(v)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const coerceCount=(v)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const STALE_MS=24*60*60*1000;
// Cron should run every 5 minutes. More than four missed intervals means
// the monitoring service is NOT confirmed healthy, even if its history is <24h.
export const CRON_HEALTH_MS=20*60*1000;
const LIMIT=20;

export function validateAutoStatusScope(url){
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||
     [...url.searchParams.keys()].length!==0)
    throw Error('invalid_auto_status_scope');
}
export function normalizeAutoRuntime(row,nowMs){
  if(!row||!int(row.generation)||!int(row.next_offset)||
    (row.total_first_seen!==null&&!int(row.total_first_seen))||
    !STATUS.has(row.run_status)||!int(row.last_success_ms)||
    !Number.isSafeInteger(nowMs)||nowMs<0)
    throw Error('auto_runtime_unverified');
  const completed=row.run_status==='pass_complete'&&row.generation>0&&
    row.total_first_seen!==null&&row.next_offset>=row.total_first_seen;
  const healthy=row.last_success_ms>0&&row.last_success_ms<=nowMs&&
    nowMs-row.last_success_ms<=STALE_MS;
  return {
    generation:row.generation,
    scannedOffset:row.next_offset,
    totalAtStart:row.total_first_seen,
    scanState:row.run_status,
    lastSuccessMs:row.last_success_ms||null,
    lastErrorCode:short(row.last_error_code,64)||null,
    fullHistoricalPass:completed,
    freshness:!row.last_success_ms?'never':healthy?'recent':'stale'
  };
}
export function summarizeAutoStatus(runtime,counts,rows,nowMs){
  if(!runtime||!Array.isArray(rows)||rows.length>LIMIT||
    !counts||!int(counts.checked)||!int(counts.incomplete)||
    !int(counts.complete)||!int(counts.unverified)||
    counts.checked!==counts.incomplete+counts.complete+counts.unverified)
    throw Error('auto_summary_unverified');
  const verifiedCoverage=runtime.fullHistoricalPass&&
    counts.checked===runtime.totalAtStart;
  const scope=verifiedCoverage?
    'COMPLETED_NONATOMIC_HISTORICAL_PASS_NOT_LIVE_ACTIVE_QUEUE':
    'PARTIAL_HISTORICAL_SCAN_NOT_LIVE_ACTIVE_QUEUE';
  const recent=runtime.freshness==='recent';
  const elapsed=runtime.lastSuccessMs===null?null:nowMs-runtime.lastSuccessMs;
  const monitorHealth=['paused','error'].includes(runtime.scanState)?
    'stopped':elapsed===null?'not_started':
      elapsed>=0&&elapsed<=CRON_HEALTH_MS?'on_schedule':'delayed';
  const seen=new Set();
  const visible=rows.map(row=>{
    const number=short(row?.number,10);
    if(!number||!/^\d{1,10}$/.test(number)||
      row.task_stage_status!=='incomplete'||
      !short(row.task_id,36)||!UUID.test(row.task_id)||
      seen.has(row.task_id.toLowerCase())||
      (row.remaining_qty!==null&&!finite(row.remaining_qty))||
      (row.planned_qty!==null&&!finite(row.planned_qty))||
      !int(row.checked_ms)||row.checked_ms>nowMs)
      throw Error('auto_rows_unverified');
    seen.add(row.task_id.toLowerCase());
    return {
      number,
      status:'incomplete',
      remaining:row.remaining_qty,
      plan:row.planned_qty,
      firstUnfinishedStage:short(row.first_unfinished_stage,100),
      plannedDate:short(row.plan_date,40),
      checkedMs:row.checked_ms,
      // A past calendar date is a DIAGNOSTIC, not a contractual SLA.
      plannedDateControl:classifyProductionPlanDate(
        {plannedDate:row.plan_date},{status:'incomplete'},nowMs)
    };
  });
  if(visible.length>counts.incomplete)throw Error('auto_rows_unverified');
  const visibleDateChecks={
    past:visible.filter(x=>x.plannedDateControl==='past').length,
    today:visible.filter(x=>x.plannedDateControl==='today').length,
    future:visible.filter(x=>x.plannedDateControl==='future').length,
    notSet:visible.filter(x=>x.plannedDateControl==='not_set').length,
    unverified:visible.filter(x=>x.plannedDateControl==='unverified').length
  };
  if(Object.values(visibleDateChecks).reduce((a,b)=>a+b,0)!==visible.length)
    throw Error('auto_date_summary_unverified');
  return {
    code:'ms_production_auto_status_ok',
    readOnly:true,changedRecords:0,
    source:'DEDICATED_MS_PRODUCTION_D1_CURSOR',
    scope,
    scanState:runtime.scanState,
    generation:runtime.generation,
    scannedOffset:runtime.scannedOffset,
    totalAtStart:runtime.totalAtStart,
    lastSuccessMs:runtime.lastSuccessMs,
    freshness:runtime.freshness,
    monitorHealth,
    expectedIntervalMinutes:5,
    lastErrorCode:runtime.lastErrorCode,
    completeHistoricalPass:verifiedCoverage,
    approvedForLiveQueue:false,
    totals:counts,
    shown:visible.length,
    visibleDateChecks,
    remainingRowsNotShown:Math.max(0,counts.incomplete-visible.length),
    items:visible,
    sampleTime:new Date(nowMs).toISOString(),
    dataRecent:recent
  };
}
export function createProductionAutoStatusHandler({now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    try{validateAutoStatusScope(new URL(request.url));}
    catch{return json(400,{code:'invalid_auto_status_scope'});}
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
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
    if(!env.MS_PRODUCTION_DB)
      return json(503,{code:'ms_auto_storage_not_configured',readOnly:true});
    try{
      const db=env.MS_PRODUCTION_DB;
      const runtimeRaw=await db.prepare(
        'SELECT generation,next_offset,total_first_seen,run_status,last_success_ms,last_error_code FROM ms_production_auto_runtime WHERE id=1 LIMIT 1'
      ).first();
      const timestamp=now();
      const runtime=normalizeAutoRuntime(runtimeRaw,timestamp);
      const query=await db.prepare(
        "SELECT COUNT(*) AS checked, COALESCE(SUM(CASE WHEN task_stage_status='incomplete' THEN 1 ELSE 0 END),0) AS incomplete, COALESCE(SUM(CASE WHEN task_stage_status='complete' THEN 1 ELSE 0 END),0) AS complete, COALESCE(SUM(CASE WHEN task_stage_status='unverified' THEN 1 ELSE 0 END),0) AS unverified FROM ms_production_auto_tasks WHERE generation = ?"
      ).bind(runtime.generation).first();
      if(!query)throw Error('no_counts');
      const counts={
        checked:coerceCount(query.checked),incomplete:coerceCount(query.incomplete),
        complete:coerceCount(query.complete),unverified:coerceCount(query.unverified)
      };
      if(Object.values(counts).some(v=>v===null))
        throw Error('invalid_counts');
      const active=await db.prepare(
        "SELECT task_id,number,task_stage_status,remaining_qty,planned_qty,first_unfinished_stage,plan_date,checked_ms FROM ms_production_auto_tasks WHERE generation=? AND task_stage_status='incomplete' ORDER BY checked_ms DESC,number DESC LIMIT 20"
      ).bind(runtime.generation).all();
      if(!Array.isArray(active?.results))throw Error('invalid_results');
      return json(200,summarizeAutoStatus(runtime,counts,active.results,timestamp));
    }catch{
      return json(503,{code:'ms_auto_status_unavailable',readOnly:true});
    }
  };
}
export const onRequestGet=createProductionAutoStatusHandler();
