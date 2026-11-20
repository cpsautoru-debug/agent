import {assessProductionTask} from './ms-production-audit.mjs';
import {classifyProductionPlanDate} from './ms-production-plan-date.mjs';
import {summarizeRecentProduction} from './ms-production-board-core.mjs';

// User-selected real order numbers: at most five exact lookups, not the full queue.
// Each number requires up to two owner-only reads (document then stages).
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PRIORITY_TASKS=5;
export const PRIORITY_DELAY_MS=2000;
const safeCode=s=>typeof s==='string'&&/^[a-z][a-z0-9_]{0,64}$/.test(s)?
  s:'ms_priority_request_failed';
const invalid=code=>Object.assign(Error(code),{code});

export function parsePriorityNumbers(input){
  if(typeof input!=='string'||input.length>120)throw invalid('invalid_task_numbers');
  const parts=input.trim().split(/[,\s;]+/u).filter(Boolean);
  if(!parts.length||parts.length>MAX_PRIORITY_TASKS||
    parts.some(number=>!/^\d{1,10}$/.test(number))||
    new Set(parts).size!==parts.length)
    throw invalid('invalid_task_numbers');
  return parts;
}
export function verifyExactTaskFeed(data,number){
  if(data?.code!=='ms_production_feed_ok'||data.readOnly!==true||
    data.changedRecords!==0||data.searchNumber!==number||
    data.selection!=='EXACT_DOCUMENT_NUMBER_NOT_ACTIVE_TASKS'||
    data.totalAllTime!==null||!Number.isSafeInteger(data.totalMatching)||
    data.totalMatching<0||data.pageSize!==5||data.offset!==0||
    !Array.isArray(data.records)||data.records.length>1)
    throw invalid('ms_priority_task_unverified');
  if(data.totalMatching===0&&data.records.length===0)return null;
  if(data.totalMatching!==1||data.records.length!==1)
    throw invalid('ms_priority_task_ambiguous');
  const task=data.records[0];
  if(!task||task.number!==number||typeof task.date!=='string'||
    !/^\d{4}-\d{2}-\d{2}/.test(task.date)||task.date.length>40||
    (task.id!==null&&(typeof task.id!=='string'||!UUID.test(task.id)))||
    (task.plannedDate!==null&&
      (typeof task.plannedDate!=='string'||task.plannedDate.length>40)))
    throw invalid('ms_priority_task_unverified');
  return task;
}
export async function collectPriorityProduction({
  numbers,request,pause=async()=>{},active=()=>true,
  onProgress=()=>{},nowMs=Date.now()
}){
  if(!Array.isArray(numbers)||numbers.length<1||numbers.length>MAX_PRIORITY_TASKS||
    numbers.some(x=>typeof x!=='string'||!/^\d{1,10}$/.test(x))||
    new Set(numbers).size!==numbers.length||
    typeof request!=='function'||typeof pause!=='function'||
    typeof active!=='function'||typeof onProgress!=='function'||
    !Number.isFinite(nowMs))
    throw invalid('invalid_priority_setup');
  let requests=0,stage='feed';
  const get=async path=>{
    if(!active())throw invalid('ms_priority_cancelled');
    if(requests>=2*MAX_PRIORITY_TASKS)throw invalid('ms_priority_request_limit');
    if(requests>0){
      await pause(PRIORITY_DELAY_MS);
      if(!active())throw invalid('ms_priority_cancelled');
    }
    requests++;
    const response=await request(path);
    if(!response||!Number.isInteger(response.status))
      throw invalid('ms_priority_transport_error');
    if(response.status!==200)throw invalid(safeCode(response.body?.code));
    return response.body;
  };
  try{
    const items=[];
    for(const number of numbers){
      stage='feed';
      const task=verifyExactTaskFeed(await get('/api/ms/production-feed?number='+
        encodeURIComponent(number)),number);
      let item;
      if(task===null){
        item={number,status:'unverified',code:'task_not_found',
          planDateStatus:'unverified',plannedDate:null};
      }else if(!task.id){
        item={number,status:'unverified',code:'missing_task_id',
          planDateStatus:'unverified',plannedDate:task.plannedDate};
      }else{
        stage='stages';
        const body=await get('/api/ms/production-stages?taskId='+encodeURIComponent(task.id));
        const audit=body?.code==='ms_production_stages_ok'?
          assessProductionTask(task,body):
          {number,status:'unverified',code:'ms_priority_stage_unverified'};
        item={...audit,number,plannedDate:task.plannedDate||null,
          planDateStatus:classifyProductionPlanDate(task,audit,nowMs)};
      }
      items.push(item);
      onProgress({number,checked:items.length,total:numbers.length,requests});
    }
    if(!active())throw invalid('ms_priority_cancelled');
    return {code:'ms_priority_production_ok',
      readOnly:true,changedRecords:0,
      scope:'EXACT_USER_SELECTED_TASK_NUMBERS_NOT_ALL_ACTIVE_ORDERS',
      requests,numbers:[...numbers],items,
      summary:summarizeRecentProduction(items),
      sampledAt:new Date(nowMs).toISOString()};
  }catch(error){
    return {code:'ms_priority_production_unverified',
      readOnly:true,changedRecords:0,
      scope:'EXACT_USER_SELECTED_TASK_NUMBERS_NOT_ALL_ACTIVE_ORDERS',
      requests,stage,reason:safeCode(error?.code||error?.message)};
  }
}
export function buildPriorityCsv(items){
  if(!Array.isArray(items)||items.length>MAX_PRIORITY_TASKS)
    throw invalid('invalid_priority_export');
  const safe=value=>{
    let s=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180);
    if(/^\s*[=+\-@]/u.test(s))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  const rows=[['Номер задания','Статус проверки','План','Выполнено заключительного этапа',
    'Осталось','Первый незавершённый этап','Плановая дата','Дата','Примечание']];
  for(const item of items){
    if(typeof item?.number!=='string'||!/^\d{1,10}$/.test(item.number))
      throw invalid('invalid_priority_export');
    const status=['incomplete','complete'].includes(item.status)?item.status:'unverified';
    rows.push([item.number,status,
      typeof item.plan==='number'?item.plan:'Не подтверждено',
      typeof item.finished==='number'?item.finished:'Не подтверждено',
      typeof item.remaining==='number'?item.remaining:'Не подтверждено',
      item.firstUnfinishedStage||'',item.plannedDate||'Не указана',
      item.planDateStatus||'Не подтверждено',
      'Только проверенные номера; не вся текущая очередь производства']);
  }
  return '\uFEFF'+rows.map(row=>row.map(safe).join(';')).join('\r\n')+'\r\n';
}
