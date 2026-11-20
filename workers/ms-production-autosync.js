import {summarizeStages} from '../functions/api/ms/production-stages.js';
import {assessProductionTask} from '../web/office/ms-production-audit.mjs';

// One bounded scheduled batch. No HTTP handler, no customer-data export,
// no MoySklad writes and never a claim that all historical tasks are active.
export const BATCH_SIZE=5;
export const REQUESTS_PER_TICK=6;
export const REQUEST_GAP_MS=2000;
const MS='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NUMBER=/^\d{1,10}$/;
const MOMENT=/^\d{4}-\d\d-\d\d(?:[ T].*)?$/;
const safeCode=error=>{
  const message=String(error?.code||error?.message||'ms_auto_sync_error');
  return /^(ms_auto_|ms_api_|ms_rate_limited|ms_timeout|invalid_)[a-z0-9_]*$/.test(message)?
    message.slice(0,64):'ms_auto_sync_error';
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const apiUrl=(kind,params)=>{
  const url=new URL(MS+kind);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  return url.toString();
};
export function taskPageUrl(offset){
  if(!Number.isSafeInteger(offset)||offset<0||offset% BATCH_SIZE!==0||offset>100000)
    throw Error('invalid_production_cursor');
  return apiUrl('productiontask',{
    limit:BATCH_SIZE,offset,order:'moment,asc'
  });
}
export function stageUrl(taskId){
  if(!UUID.test(taskId))throw Error('invalid_production_id');
  return apiUrl('productionstage',{
    limit:50,offset:0,expand:'stage',filter:'productionTask='+MS+'productiontask/'+taskId
  });
}
export function parseProductionPage(data,offset){
  if(!Number.isSafeInteger(offset)||offset<0||offset%BATCH_SIZE!==0||
    !Number.isSafeInteger(data?.meta?.size)||data.meta.size<0||
    !Array.isArray(data?.rows)||
    // An incomplete page can shift the cursor and silently omit assignments.
    // Never commit any portion of a page that is shorter than requested.
    data.rows.length!==Math.min(BATCH_SIZE,Math.max(0,data.meta.size-offset)))
    throw Error('invalid_production_page');
  const ids=new Set();
  const tasks=data.rows.map(row=>{
    if(!row||typeof row.id!=='string'||!UUID.test(row.id)||
      !NUMBER.test(row.name)||typeof row.moment!=='string'||
      row.moment.length>40||!MOMENT.test(row.moment)||
      ids.has(row.id.toLowerCase()))
      throw Error('invalid_production_page');
    ids.add(row.id.toLowerCase());
    const date=typeof row.deliveryPlannedMoment==='string'&&
      row.deliveryPlannedMoment.length<=40&&MOMENT.test(row.deliveryPlannedMoment)?
      row.deliveryPlannedMoment:null;
    return {id:row.id.toLowerCase(),number:row.name,date:row.moment,
      updated:typeof row.updated==='string'&&row.updated.length<=40?row.updated:null,
      plannedDate:date};
  });
  return {total:data.meta.size,tasks};
}
export function normalizeTaskStages(task,payload){
  try{
    const stages=summarizeStages(payload);
    const result=assessProductionTask(task,stages);
    if(!['complete','incomplete'].includes(result.status))
      return {status:'unverified',plan:null,finished:null,remaining:null,firstStage:null};
    return {status:result.status,plan:result.plan,finished:result.finished,
      remaining:result.remaining,firstStage:result.firstUnfinishedStage||null};
  }catch{
    return {status:'unverified',plan:null,finished:null,remaining:null,firstStage:null};
  }
}
async function readJson(response,limit){
  const reader=response.body?.getReader();
  if(!reader)throw Error('ms_api_body_unavailable');
  let size=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done){raw+=decoder.decode();break;}
      size+=value.byteLength;
      if(size>limit)throw Error('ms_api_response_too_large');
      raw+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(raw);}catch{throw Error('ms_api_invalid_json');}
}
export function makeLimitedReader(env,{fetcher=fetch,pause=sleep}={}){
  let count=0;
  return {
    async read(url,cap){
      if(count>=REQUESTS_PER_TICK)throw Error('ms_auto_budget_exhausted');
      if(count>0)await pause(REQUEST_GAP_MS);
      count++;
      const response=await fetcher(url,{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
          Accept:'application/json;charset=utf-8'},
        signal:AbortSignal.timeout(20000)
      });
      if(response.status!==200){
        await response.body?.cancel().catch(()=>{});
        throw Error(response.status===429?'ms_rate_limited':
          response.status===401?'ms_api_auth_failed':
          response.status===403?'ms_api_permissions_failed':
          'ms_api_upstream_error');
      }
      return readJson(response,cap);
    },
    get count(){return count;}
  };
}
async function unlock(db,status,code=''){
  await db.prepare(
    'UPDATE ms_production_auto_runtime SET run_status=?,last_error_code=?,lock_until_ms=0,updated_at=CURRENT_TIMESTAMP WHERE id=1'
  ).bind(status,code).run();
}
export async function runMsProductionTick(env,options={}){
  if(env?.MS_PRODUCTION_AUTO_SYNC!=='enabled')return {code:'ms_auto_disabled',requests:0};
  const db=env?.MS_PRODUCTION_DB;
  if(!db||typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
    /\s/.test(env.MS_API_TOKEN))
    return {code:'ms_auto_missing_binding',requests:0};
  const now=options.nowMs??Date.now();
  if(!Number.isSafeInteger(now)||now<=0)throw Error('invalid_runtime_clock');
  // Independent D1 database only, not finance/office D1.
  const locked=await db.prepare(
    'UPDATE ms_production_auto_runtime SET lock_until_ms=?,last_request_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND lock_until_ms<=? AND last_request_ms<=? RETURNING generation,next_offset,total_first_seen,run_status'
  ).bind(now+180000,now,now,now-240000).first();
  if(!locked)return {code:'ms_auto_locked_or_recent',requests:0};
  const request=makeLimitedReader(env,options);
  try{
    let generation=locked.generation;
    let offset=locked.next_offset;
    let expected=locked.total_first_seen;
    if(locked.run_status==='new'||locked.run_status==='pass_complete'){
      generation++;offset=0;expected=null;
    }
    const page=parseProductionPage(
      await request.read(taskPageUrl(offset),128*1024),offset
    );
    if(expected===null)expected=page.total;
    if(page.total!==expected||offset>expected)
      throw Error('ms_auto_source_count_changed');
    const items=[];
    for(const task of page.tasks){
      const raw=await request.read(stageUrl(task.id),256*1024);
      const stage=normalizeTaskStages(task,raw);
      items.push({task,...stage});
    }
    const nextOffset=offset+items.length;
    if(nextOffset<=offset&&offset<expected)
      throw Error('ms_auto_missing_page');
    const statements=items.map(item=>db.prepare(
      'INSERT INTO ms_production_auto_tasks(generation,task_id,number,document_moment,document_updated,plan_date,task_stage_status,planned_qty,completed_last_stage_qty,remaining_qty,first_unfinished_stage,checked_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(generation,task_id) DO NOTHING'
    ).bind(generation,item.task.id,item.task.number,item.task.date,
      item.task.updated,item.task.plannedDate,item.status,item.plan,item.finished,
      item.remaining,item.firstStage,now));
    const status=nextOffset>=expected?'pass_complete':'scanning';
    statements.push(db.prepare(
      'UPDATE ms_production_auto_runtime SET generation=?,next_offset=?,total_first_seen=?,run_status=?,last_error_code=?,lock_until_ms=0,last_success_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=1'
    ).bind(generation,nextOffset,expected,status,'',now));
    await db.batch(statements);
    return {code:'ms_auto_batch_committed',requests:request.count,
      processed:items.length,offset:nextOffset,totalAtStart:expected,
      generation,coverage:'BOUNDED_HISTORICAL_PASS_NOT_ALL_ACTIVE',status};
  }catch(error){
    try{await unlock(db,'paused',safeCode(error));}catch{}
    return {code:safeCode(error),requests:request.count,
      coverage:'UNVERIFIED_STOPPED',changedRecordsInMoySklad:0};
  }
}
export default {
  async scheduled(_event,env,ctx){
    ctx.waitUntil(runMsProductionTick(env));
  }
};
