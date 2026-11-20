// Local, read-only analysis of a deliberately bounded set of production tasks.
// Never interpret a partial page as the whole backlog.
export function assessProductionTask(task,payload){
  if(typeof task?.number!=='string'||!Array.isArray(payload?.stages)||
    payload.code!=='ms_production_stages_ok'||
    !Number.isFinite(payload.plan)||!Number.isFinite(payload.finishedFinalStage)||
    payload.plan<0||payload.finishedFinalStage<0||
    payload.finishedFinalStage>payload.plan||
    payload.stages.length===0||payload.plan===0){
    return {number:String(task?.number||'—'),status:'unverified',code:'unverified_stage_data'};
  }
  const stages=[...payload.stages].sort((a,b)=>a.order-b.order);
  for(const s of stages){
    if(!Number.isInteger(s.order)||typeof s.name!=='string'||s.name.length>100||
      typeof s.plan!=='number'||typeof s.done!=='number'||
      s.plan<0||s.done<0||s.done>s.plan)
      return {number:task.number,status:'unverified',code:'unverified_stage_data'};
  }
  // A page audit must not infer an exact shop-floor status from missing,
  // inconsistent or non-monotonic stage chains.
  const tolerance=0.000001;
  let previousDone=payload.plan;
  const seenOrders=new Set();
  for(const s of stages){
    if(seenOrders.has(s.order)||
      Math.abs(s.plan-payload.plan)>tolerance||
      s.done>previousDone+tolerance){
      return {number:task.number,status:'unverified',code:'stage_chain_not_verified'};
    }
    seenOrders.add(s.order);
    previousDone=s.done;
  }
  if(Math.abs(previousDone-payload.finishedFinalStage)>tolerance)
    return {number:task.number,status:'unverified',code:'final_stage_mismatch'};
  const remains=Math.round((payload.plan-payload.finishedFinalStage)*1000)/1000;
  const firstUnfinished=stages.find(s=>s.done<s.plan-1e-9);
  // A complete last stage with an earlier incomplete stage is a data discrepancy.
  if(remains===0&&firstUnfinished)
    return {number:task.number,status:'unverified',code:'non_monotonic_stage_completion'};
  if(remains>0&&!firstUnfinished)
    return {number:task.number,status:'unverified',code:'missing_unfinished_stage'};
  return {
    number:task.number,
    status:remains>0?'incomplete':'complete',
    plan:payload.plan,
    finished:payload.finishedFinalStage,
    remaining:remains,
    firstUnfinishedStage:firstUnfinished?.name||null
  };
}
export function summarizePageAudit(taskCount,results){
  if(!Number.isInteger(taskCount)||taskCount<0||taskCount>5||
    !Array.isArray(results)||results.length>taskCount)
    throw Error('invalid_audit_scope');
  const stats={checked:results.length,incomplete:0,complete:0,unverified:0,notChecked:taskCount-results.length,
    firstUnfinishedStages:[]};
  const stageCounts=new Map();
  for(const item of results){
    if(item?.status==='incomplete'){
      stats.incomplete++;
      const name=item.firstUnfinishedStage;
      if(typeof name==='string'&&name.length<=100)
        stageCounts.set(name,(stageCounts.get(name)||0)+1);
    }else if(item?.status==='complete')stats.complete++;
    else stats.unverified++;
  }
  stats.firstUnfinishedStages=[...stageCounts].map(([name,tasks])=>({name,tasks}))
    .sort((a,b)=>b.tasks-a.tasks||a.name.localeCompare(b.name,'ru'));
  stats.scope='ONLY_SELECTED_PAGE_NOT_ALL_UNFINISHED_PRODUCTION';
  return stats;
}
