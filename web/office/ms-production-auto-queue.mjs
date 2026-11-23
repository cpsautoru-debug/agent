import {assessProductionTask} from './ms-production-audit.mjs';
import {selectProductionRechecks} from './ms-production-queue-selection.mjs';

// Automatic, owner-only TRIAGE. Historical candidates are never sent to shop
// floor as work orders. Fresh source checks are bounded to avoid API overload.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const root=el('msAutoQueue'),status=el('msAutoQueueStatus');
  const summary=el('msAutoQueueSummary'),table=el('msAutoQueueTable');
  const tbody=el('msAutoQueueRows'),refresh=el('msAutoQueueRefresh');
  if([root,status,summary,table,tbody,refresh].some(x=>!x))return;
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MAX_LIVE_CHECKS=6,DELAY_MS=2000,EVERY_MS=5*60*1000;
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(n);
  const clock=n=>new Intl.DateTimeFormat('ru-RU',{
    dateStyle:'short',timeStyle:'short',timeZone:'Europe/Samara'
  }).format(new Date(n));
  const td=(tr,value)=>{
    const cell=document.createElement('td');
    cell.textContent=String(value);tr.append(cell);return cell;
  };
  const inView=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const safeItem=item=>item&&UUID.test(item.taskId)&&
    typeof item.number==='string'&&/^\d{1,10}$/.test(item.number)&&
    ['incomplete','unverified'].includes(item.status)&&
    Number.isSafeInteger(item.checkedMs)&&item.checkedMs<=Date.now()&&
    ['past','today','future','not_set','unverified'].includes(item.plannedDateControl);
  const valid=data=>data?.code==='ms_production_queue_candidates_ok'&&
    data.readOnly===true&&data.changedRecords===0&&
    data.approvedForDispatch===false&&
    data.scope==='HISTORICAL_CANDIDATES_NEED_LIVE_STAGE_AND_ORDER_VERIFICATION'&&
    data.completeHistoricalCoverage===true&&
    Array.isArray(data.items)&&data.items.length<=40&&
    Number.isSafeInteger(data.shown)&&data.shown===data.items.length&&
    Number.isSafeInteger(data.counts?.incomplete)&&
    Number.isSafeInteger(data.counts?.unverified)&&
    data.items.every(safeItem)&&
    new Set(data.items.map(x=>x.taskId)).size===data.items.length;
  const openTask=number=>{
    const input=el('msProductionNumber');
    const form=el('msProductionSearchForm');
    if(!input||!form)return;
    input.value=number;
    form.requestSubmit();
    el('msProductionMonitor')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  const dateText={
    past:'Плановая дата прошла',today:'Сегодня',future:'Впереди',
    not_set:'Не задана',unverified:'Не подтверждена'
  };
  const statuses={
    incomplete:'Незавершённые этапы в истории',
    unverified:'Исторические этапы не подтверждены',
    live_incomplete:'Незавершённые этапы подтверждены сейчас',
    live_complete:'Этапы выполнены при повторной проверке',
    live_unverified:'Повторная проверка не удалась'
  };
  let running=false,lastAttempt=0;
  const request=async (path,timeoutMs=20000)=>{
    const result=await fetch(path,{method:'GET',credentials:'same-origin',
      cache:'no-store',headers:{Accept:'application/json'},
      signal:AbortSignal.timeout(timeoutMs)});
    if(!result.ok){
      let detail=null;
      try{detail=(await result.json())?.code;}catch{}
      // Do not disclose response bodies or upstream credentials to the UI.
      const error=Error('source_unavailable');
      error.code=typeof detail==='string'&&
        /^(ms_[a-z_]{3,55}|production_task_identity_unverified)$/.test(detail)?
        detail:'source_unavailable';
      throw error;
    }
    return result.json();
  };
  const render=(data,items)=>{
    tbody.replaceChildren();
    for(const item of items){
      const tr=document.createElement('tr');
      const numberCell=document.createElement('td');
      const button=document.createElement('button');
      button.type='button';button.className='ms-production-detail-button';
      button.textContent=item.number;
      button.addEventListener('click',()=>openTask(item.number));
      numberCell.append(button);tr.append(numberCell);
      td(tr,statuses[item.liveStatus||item.status]||'Не подтверждено');
      td(tr,item.liveStatus==='live_complete'?'Все этапы выполнены':
        item.liveStatus==='live_incomplete'?
          (item.liveStage||'Не подтверждено'):
          item.firstUnfinishedStage?
            item.firstUnfinishedStage+' (историческая проверка)':
            'Не подтверждено');
      const ev=item.orderEvidence;
      const label=ev?.code==='ms_order_evidence_ok'?
        (ev.linkage==='none'?'Связи нет':
          ev.orderStatusVerified?
            'Статусы: '+ev.orders.map(x=>x.stateName+
              (x.terminal===true?' (финальный)':
                x.stateType==='Regular'?' (обычный)':
                ' (тип не подтверждён)')).join('; '):
            'Связь есть, статусы не подтверждены'):
        ev?.code==='ms_order_evidence_unverified'?
          'Связь не подтверждена':
          item.orderEvidenceError==='ms_rate_limited'?'Лимит API · повторим позже':
          item.orderEvidenceError?'Не удалось прочитать статус заказа':
          'Ещё не проверен';
      td(tr,label);
      td(tr,item.plannedDate||'Не задана');
      const check=td(tr,item.liveCheckedMs?
        clock(item.liveCheckedMs)+' · этапы проверены через API':
        item.liveAttemptMs?
          clock(item.liveAttemptMs)+' · повторная проверка не удалась':
          clock(item.checkedMs)+' · фоновый сканер');
      if(item.plannedDateControl==='past')check.className='ms-auto-overdue';
      const action=document.createElement('td');
      const open=document.createElement('button');open.type='button';
      open.className='ms-production-detail-button';open.textContent='Проверить';
      open.addEventListener('click',()=>openTask(item.number));
      action.append(open);tr.append(action);tbody.append(tr);
    }
    table.hidden=items.length===0;
    const ready=items.filter(x=>x.liveStatus==='live_incomplete').length;
    const verifiedComplete=items.filter(x=>x.liveStatus==='live_complete').length;
    const unknown=items.filter(x=>x.liveStatus==='live_unverified').length;
    const remaining=items.length-ready-verifiedComplete-unknown;
    const linked=items.filter(x=>x.orderEvidence?.linkage==='linked').length;
    const checkedLinks=items.filter(x=>x.orderEvidence!==undefined||
      x.orderEvidenceError).length;
    const health=data.monitorHealthy?'Сканер работает по расписанию.':
      'Внимание: свежесть фонового сканера не подтверждена.';
    status.textContent=health+' Найдено кандидатов: '+fmt(data.counts.incomplete+
      data.counts.unverified)+'. Подтверждённо незавершённых при повторной проверке: '+
      fmt(ready)+'. Это не подтверждённая живая очередь заказов покупателей.';
    summary.textContent='Последний полный исторический проход №'+
      fmt(data.baselineGeneration)+'. '+(data.inProgress?'Следующий обход продолжается. ':'')+
      'Этапы подтверждены через API: '+fmt(ready+verifiedComplete)+
      ', неудачных повторных проверок: '+fmt(unknown)+
      ', ещё не перепроверено: '+fmt(remaining)+
      ', этапы уже выполнены: '+fmt(verifiedComplete)+
      '. Скрыто по лимиту списка: '+fmt(data.additionalCandidatesNotShown)+
      '. Проверены связи с заказами: '+fmt(checkedLinks)+
      ', связь обнаружена: '+fmt(linked)+
      '. Названия статусов показаны без автоматической трактовки: '+
      'их соответствие рабочим/закрытым заказам пока не настроено. '+
      'Сотрудникам задания автоматически не назначаются.';
  };
  const liveCheck=async item=>{
    // Compare the live task ID to the saved scan ID: never transfer a
    // similarly numbered document's stages onto a different task.
    const feed=await request('/api/ms/production-feed?number='+encodeURIComponent(item.number));
    if(feed?.code!=='ms_production_feed_ok'||
      feed.selection!=='EXACT_DOCUMENT_NUMBER_NOT_ACTIVE_TASKS'||
      feed.totalMatching!==1||feed.records?.length!==1||
      feed.records[0].id?.toLowerCase()!==item.taskId)
      throw Error('live_task_identity_unverified');
    const stages=await request('/api/ms/production-stages?taskId='+encodeURIComponent(item.taskId));
    const result=assessProductionTask({number:item.number},stages);
    if(!['incomplete','complete'].includes(result.status))
      throw Error('live_stages_unverified');
    let orderEvidence,orderEvidenceError=false;
    // Only do extra order lookups after the task identity and stages have
    // been verified. This endpoint is owner-only and never returns PII.
    try{
      const evidence=await request(
        '/api/ms/production-order-evidence?number='+encodeURIComponent(item.number),
        70000);
      if(evidence?.taskId!==item.taskId||
        !['ms_order_evidence_ok','ms_order_evidence_unverified']
          .includes(evidence?.code)||evidence.approvedForDispatch!==false)
        throw Error('unverified_order_evidence');
      orderEvidence=evidence;
    }catch(error){
      orderEvidenceError=typeof error?.code==='string'?
        error.code:'source_unavailable';
    }
    return {
      ...item,orderEvidence,orderEvidenceError,
      liveStatus:result.status==='incomplete'?'live_incomplete':'live_complete',
      liveStage:result.status==='incomplete'?result.firstUnfinishedStage:null,
      liveCheckedMs:Date.now()
    };
  };
  const load=async()=>{
    if(!inView()||running)return;
    running=true;lastAttempt=Date.now();refresh.disabled=true;
    table.hidden=true;tbody.replaceChildren();
    status.textContent='Получаем кандидатов из автоматического сканера…';
    summary.textContent='';
    try{
      const data=await request('/api/ms/production-queue');
      if(!valid(data))throw Error('queue_unverified');
      const items=data.items.map(item=>({...item}));
      render(data,items);
      // Prioritize previously incomplete stages, then rotate the uncertain
      // historical candidates every refresh. A candidate is not a work order.
      const checkOrder=selectProductionRechecks(
        items,Date.now(),MAX_LIVE_CHECKS,EVERY_MS);
      let checked=0;
      for(const i of checkOrder){
        if(!inView())break;
        if(checked>0)await pause(DELAY_MS);
        checked++;
        try{items[i]=await liveCheck(items[i]);}
        catch{items[i]={...items[i],liveStatus:'live_unverified',
          liveAttemptMs:Date.now()};}
        render(data,items);
      }
    }catch{
      tbody.replaceChildren();table.hidden=true;
      status.textContent='Автоматическая очередь не подтверждена. Не выдаём архивные задания за текущие.';
      summary.textContent='Проверьте состояние фонового сканера ниже. Номера вручную вводить не требуется.';
    }finally{running=false;refresh.disabled=false;}
  };
  refresh.addEventListener('click',()=>{if(!running)void load();});
  const maybe=()=>{if(inView()&&!running&&Date.now()-lastAttempt>=EVERY_MS)void load();};
  window.addEventListener('hashchange',maybe);
  document.addEventListener('visibilitychange',maybe);
  window.setInterval(maybe,60000);
  maybe();
})();
