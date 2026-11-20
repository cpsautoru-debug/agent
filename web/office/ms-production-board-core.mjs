import {assessProductionTask} from './ms-production-audit.mjs';
import {classifyProductionPlanDate} from './ms-production-plan-date.mjs';

// A bounded, user-triggered production triage of the 10 most recent documents.
// This is NOT a complete list of open production, bookings or customer orders.
export const MAX_TASKS=10;
export const REQUEST_DELAY_MS=2000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const code=e=>typeof e==='string'&&/^[a-z][a-z0-9_]{0,64}$/.test(e)?e:'ms_request_failed';
function invalid(reason){const err=Error(reason);err.code=reason;return err;}
export function checkProductionFeed(payload,offset){
  if(payload?.code!=='ms_production_feed_ok'||payload.readOnly!==true||
    payload.changedRecords!==0||payload.selection!=='LATEST_5_BY_DOCUMENT_DATE_NOT_ACTIVE_TASKS'||
    payload.pageSize!==5||payload.offset!==offset||
    payload.searchNumber!==null||!Number.isSafeInteger(payload.totalAllTime)||
    payload.totalAllTime<0||!Array.isArray(payload.records)||
    payload.records.length>5||typeof payload.hasMore!=='boolean'||
    offset+payload.records.length>payload.totalAllTime||
    (payload.hasMore&&payload.records.length!==5))
    throw invalid('ms_feed_unverified');
  for(const task of payload.records){
    if(!task||typeof task.number!=='string'||task.number.length>80||
      !/^\d{1,10}$/.test(task.number)||
      (task.id!==null&&(typeof task.id!=='string'||!UUID.test(task.id)))||
      typeof task.date!=='string'||task.date.length>40)
      throw invalid('ms_feed_unverified');
  }
  return payload;
}
export function summarizeRecentProduction(items){
  if(!Array.isArray(items)||items.length>MAX_TASKS)throw invalid('ms_queue_unverified');
  const result={
    checked:items.length,incomplete:0,complete:0,unverified:0,
    planDatePast:0,planDateToday:0,firstIncompleteStages:[],
    scope:'LATEST_10_DOCUMENTS_NOT_ALL_ACTIVE_ORDERS'
  };
  const stages=new Map();
  for(const item of items){
    if(item?.status==='incomplete'){
      result.incomplete++;
      if(item.planDateStatus==='past')result.planDatePast++;
      if(item.planDateStatus==='today')result.planDateToday++;
      if(typeof item.firstUnfinishedStage==='string'&&item.firstUnfinishedStage.length<=100)
        stages.set(item.firstUnfinishedStage,(stages.get(item.firstUnfinishedStage)||0)+1);
    }else if(item?.status==='complete')result.complete++;
    else result.unverified++;
  }
  result.firstIncompleteStages=[...stages.entries()].map(([name,tasks])=>({name,tasks}))
    .sort((a,b)=>b.tasks-a.tasks||a.name.localeCompare(b.name,'ru'));
  return result;
}
export async function collectRecentProduction({
  request,pause=async()=>{},active=()=>true,onProgress=()=>{},nowMs=Date.now()
}){
  if(typeof request!=='function'||typeof pause!=='function'||
    typeof active!=='function'||typeof onProgress!=='function'||!Number.isFinite(nowMs))
    throw invalid('invalid_production_board_setup');
  let requests=0;
  let stage='feed';
  const get=async path=>{
    if(!active())throw invalid('ms_queue_cancelled');
    if(requests>=12)throw invalid('ms_queue_request_budget');
    if(requests>0){
      await pause(REQUEST_DELAY_MS);
      if(!active())throw invalid('ms_queue_cancelled');
    }
    requests++;
    const response=await request(path);
    if(!response||!Number.isInteger(response.status))throw invalid('ms_queue_transport_error');
    if([401,403,429,503].includes(response.status)||
      response.body?.code==='ms_rate_limited')
      throw invalid(code(response.body?.code||'ms_queue_api_unavailable'));
    return response;
  };
  try{
    const r1=await get('/api/ms/production-feed');
    if(r1.status!==200)throw invalid(code(r1.body?.code));
    const first=checkProductionFeed(r1.body,0);
    const tasks=[...first.records];
    if(first.hasMore&&tasks.length<MAX_TASKS){
      const r2=await get('/api/ms/production-feed?offset=5');
      if(r2.status!==200)throw invalid(code(r2.body?.code));
      const second=checkProductionFeed(r2.body,5);
      if(second.totalAllTime!==first.totalAllTime)
        throw invalid('ms_feed_changed_during_scan');
      tasks.push(...second.records);
    }
    if(tasks.length>MAX_TASKS||new Set(tasks.map(x=>x.number)).size!==tasks.length||
      tasks.filter(x=>x.id!==null).map(x=>x.id.toLowerCase()).length!==
        new Set(tasks.filter(x=>x.id!==null).map(x=>x.id.toLowerCase())).size)
      throw invalid('ms_feed_unverified');
    stage='stages';
    const items=[];
    for(const task of tasks){
      if(!active())throw invalid('ms_queue_cancelled');
      let assessed;
      if(!task.id){
        assessed={number:task.number,status:'unverified',code:'missing_task_id'};
      }else{
        const r=await get('/api/ms/production-stages?taskId='+encodeURIComponent(task.id));
        if(r.status===200&&r.body?.code==='ms_production_stages_ok')
          assessed=assessProductionTask(task,r.body);
        else assessed={number:task.number,status:'unverified',
          code:code(r.body?.code||'ms_stages_not_available')};
      }
      const result={
        ...assessed,plannedDate:task.plannedDate||null,date:task.date,
        documentPosted:task.documentPosted,
        planDateStatus:classifyProductionPlanDate(task,assessed,nowMs)
      };
      items.push(result);
      onProgress({checked:items.length,total:tasks.length,number:task.number,requests});
    }
    if(!active())throw invalid('ms_queue_cancelled');
    return {
      code:'ms_production_board_ok',
      source:'MOYSKLAD_LATEST_10_BY_DOCUMENT_DATE',
      scope:'LATEST_10_DOCUMENTS_NOT_ALL_ACTIVE_ORDERS',
      readOnly:true,changedRecords:0,requests,
      totalAllTime:first.totalAllTime,
      items,summary:summarizeRecentProduction(items),
      sampledAt:new Date(nowMs).toISOString()
    };
  }catch(error){
    return {
      code:'ms_production_board_unverified',
      readOnly:true,changedRecords:0,requests,stage,
      reason:code(error?.code||error?.message),
      scope:'LATEST_10_DOCUMENTS_NOT_ALL_ACTIVE_ORDERS'
    };
  }
}
