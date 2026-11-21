import {summarizeStages} from '../functions/api/ms/production-stages.js';
import {assessProductionTask} from '../web/office/ms-production-audit.mjs';
import {validBridgeSecret,signBridgeRequest} from './ms-production-bridge-auth.js';

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
// A filtered productionstage response can still contain inconsistent references.
// Refuse contradictory parent IDs instead of assigning another task's progress.
// Standalone productionRow links carry no parent proof; the upstream task filter
// remains the scope for such rows.
export function verifyStageTaskLinks(taskId,payload){
  if(!UUID.test(taskId)||!Array.isArray(payload?.rows))return false;
  const expected=MS+'productiontask/'+taskId.toLowerCase();
  for(const row of payload.rows){
    const taskRef=row?.productionTask;
    if(taskRef!==undefined){
      if(typeof taskRef?.id==='string'&&
        (!UUID.test(taskRef.id)||taskRef.id.toLowerCase()!==taskId.toLowerCase()))
        return false;
      const href=taskRef?.meta?.href;
      if(href!==undefined&&
        (typeof href!=='string'||href.toLowerCase()!==expected))
        return false;
    }
    const rowHref=row?.productionRow?.meta?.href;
    if(rowHref!==undefined){
      if(typeof rowHref!=='string')return false;
      if(rowHref.includes('/entity/productiontask/')){
        const matched=/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/productiontask\/([a-f0-9-]{36})\/productionRows\/([a-f0-9-]{36})$/i.exec(rowHref);
        if(!matched||!UUID.test(matched[1])||!UUID.test(matched[2])||
          matched[1].toLowerCase()!==taskId.toLowerCase())return false;
      }
    }
  }
  return true;
}

export function normalizeTaskStages(task,payload){
  try{
    if(task?.id&&!verifyStageTaskLinks(task.id,payload))
      return {status:'unverified',plan:null,finished:null,remaining:null,firstStage:null};
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
// Only the scanner's two exact MoySklad URLs can use the bridge. The Worker
// cannot turn the Pages endpoint into an arbitrary proxy or a write endpoint.
export function bridgeUrlFor(sourceUrl){
  const input=new URL(sourceUrl);
  if(input.origin!=='https://api.moysklad.ru'||input.hash)
    throw Error('ms_auto_bridge_scope_denied');
  const keys=[...input.searchParams.keys()];
  const bridge=new URL('https://autosklad63-office-staging.pages.dev/api/ms/production-bridge');
  if(input.pathname==='/api/remap/1.2/entity/productiontask'&&
    keys.length===3&&['limit','offset','order'].every(k=>keys.includes(k))&&
    input.searchParams.get('limit')==='5'&&
    input.searchParams.get('order')==='moment,asc'&&
    /^(0|[1-9]\d{0,5})$/.test(input.searchParams.get('offset')||'')&&
    Number(input.searchParams.get('offset'))%BATCH_SIZE===0&&
    Number(input.searchParams.get('offset'))<=100000){
    bridge.searchParams.set('kind','tasks');
    bridge.searchParams.set('offset',input.searchParams.get('offset'));
    return bridge;
  }
  const stagesMatch=/^productionTask=https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/productiontask\/([a-f0-9-]{36})$/i.exec(
    input.searchParams.get('filter')||'');
  if(input.pathname==='/api/remap/1.2/entity/productionstage'&&
    keys.length===4&&['limit','offset','expand','filter'].every(k=>keys.includes(k))&&
    input.searchParams.get('limit')==='50'&&input.searchParams.get('offset')==='0'&&
    input.searchParams.get('expand')==='stage'&&stagesMatch&&
    UUID.test(stagesMatch[1])){
    bridge.searchParams.set('kind','stages');
    bridge.searchParams.set('taskId',stagesMatch[1].toLowerCase());
    return bridge;
  }
  throw Error('ms_auto_bridge_scope_denied');
}
export function makeLimitedReader(env,{fetcher=fetch,pause=sleep}={}){
  let count=0;
  const direct=typeof env.MS_API_TOKEN==='string'&&!!env.MS_API_TOKEN&&
    !/\s/.test(env.MS_API_TOKEN);
  return {
    async read(url,cap){
      if(count>=REQUESTS_PER_TICK)throw Error('ms_auto_budget_exhausted');
      if(count>0)await pause(REQUEST_GAP_MS);
      count++;
      let target=url;
      const headers={Accept:'application/json;charset=utf-8'};
      if(direct){
        headers.Authorization='Bearer '+env.MS_API_TOKEN;
      }else{
        const bridge=bridgeUrlFor(url);
        target=bridge.toString();
        const stamp=String(Date.now());
        headers['X-MS-Bridge-Time']=stamp;
        headers['X-MS-Bridge-Signature']=await signBridgeRequest(
          env.MS_PRODUCTION_BRIDGE_SECRET,stamp,bridge.pathname+bridge.search);
      }
      const response=await fetcher(target,{
        method:'GET',redirect:'manual',headers,
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
  const direct=typeof env.MS_API_TOKEN==='string'&&!!env.MS_API_TOKEN&&
    !/\s/.test(env.MS_API_TOKEN);
  if(!db||(!direct&&!validBridgeSecret(env?.MS_PRODUCTION_BRIDGE_SECRET)))
    return {code:'ms_auto_missing_binding',requests:0};
  const now=options.nowMs??Date.now();
  if(!Number.isSafeInteger(now)||now<=0)throw Error('invalid_runtime_clock');
  // Independent D1 database only, not finance/office D1.
  const locked=await db.prepare(
    'UPDATE ms_production_auto_runtime SET lock_until_ms=?,last_request_ms=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND lock_until_ms<=? AND last_request_ms<=? RETURNING generation,next_offset,total_first_seen,run_status,last_error_code'
  ).bind(now+180000,now,now,now-240000).first();
  if(!locked)return {code:'ms_auto_locked_or_recent',requests:0};
  const request=makeLimitedReader(env,options);
  try{
    let generation=locked.generation;
    let offset=locked.next_offset;
    let expected=locked.total_first_seen;
    // A moving source invalidates offsets. The NEXT tick safely starts a new
    // historical generation instead of retrying a permanently stale cursor.
    if(locked.run_status==='new'||locked.run_status==='pass_complete'||
      (locked.run_status==='paused'&&locked.last_error_code==='ms_auto_source_count_changed')){
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
      'INSERT INTO ms_production_auto_tasks(generation,task_id,number,document_moment,document_updated,plan_date,task_stage_status,planned_qty,completed_last_stage_qty,remaining_qty,first_unfinished_stage,checked_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) '
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
