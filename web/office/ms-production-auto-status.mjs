// Auto-read the dedicated production monitor's historical scan status.
// It never starts a scan, writes to D1 or requests MoySklad directly.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const root=el('msAutoHistory'),status=el('msAutoHistoryStatus');
  const details=el('msAutoHistoryDetails'),table=el('msAutoHistoryTable');
  const body=el('msAutoHistoryRows'),retry=el('msAutoHistoryRetry');
  const attention=el('msAutoHistoryAttention');
  const unknown=el('msAutoUnknown'),unknownSummary=el('msAutoUnknownSummary');
  const unknownBody=el('msAutoUnknownRows');
  if([root,status,details,table,body,retry,attention,
    unknown,unknownSummary,unknownBody].some(x=>!x))return;
  // D1-only owner GET, aligned with the 5-minute scheduled scanner.
  const EVERY_MS=5*60*1000;
  const fmt=n=>new Intl.NumberFormat('ru-RU').format(n);
  const clock=n=>new Intl.DateTimeFormat('ru-RU',{
    dateStyle:'short',timeStyle:'short',timeZone:'Europe/Samara'
  }).format(new Date(n));
  const td=(row,value)=>{
    const cell=document.createElement('td');
    cell.textContent=String(value);row.append(cell);
  };
  // Reuse the existing owner-only production search. No document numbers
  // need to be copied, and a click does not update anything in MoySklad.
  const taskLink=(row,number)=>{
    const cell=document.createElement('td');
    const button=document.createElement('button');
    button.type='button';
    button.className='ms-production-detail-button';
    button.textContent=number;
    button.setAttribute('aria-label','Проверить производственное задание №'+number);
    button.addEventListener('click',()=>{
      const field=el('msProductionNumber');
      const form=el('msProductionSearchForm');
      if(!field||!form)return;
      field.value=number;
      form.requestSubmit();
      el('msProductionMonitor')?.scrollIntoView({behavior:'smooth',block:'start'});
    });
    cell.append(button);row.append(cell);
  };
  let running=false,lastAttempt=0;
  const inView=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const reset=()=>{body.replaceChildren();table.hidden=true;
    unknownBody.replaceChildren();unknown.hidden=true;unknownSummary.textContent='';
    details.textContent='';attention.textContent='';};
  const show=(data)=>{
    if(data.code!=='ms_production_auto_status_ok'||
      data.source!=='DEDICATED_MS_PRODUCTION_D1_CURSOR'||
      data.readOnly!==true||data.changedRecords!==0||
      data.approvedForLiveQueue!==false||
      !['new','scanning','pass_complete','paused','error'].includes(data.scanState)||
      !['never','recent','stale'].includes(data.freshness)||
      !['not_started','on_schedule','delayed','stopped'].includes(data.monitorHealth)||
      data.expectedIntervalMinutes!==5||
      !Number.isSafeInteger(data.generation)||data.generation<0||
      !Number.isSafeInteger(data.scannedOffset)||data.scannedOffset<0||
      !Array.isArray(data.items)||data.items.length>20||
      !Number.isSafeInteger(data.shown)||data.shown!==data.items.length||
      !Number.isSafeInteger(data.totals?.checked)||data.totals.checked<0||
      !Number.isSafeInteger(data.totals?.incomplete)||data.totals.incomplete<0||
      !Number.isSafeInteger(data.totals?.complete)||data.totals.complete<0||
      !Number.isSafeInteger(data.totals?.unverified)||data.totals.unverified<0||
      data.totals.checked!==data.totals.incomplete+
        data.totals.complete+data.totals.unverified||
      typeof data.completeHistoricalPass!=='boolean'||
      data.shown>data.totals.incomplete||
      !Array.isArray(data.unverifiedItems)||data.unverifiedItems.length>20||
      !Number.isSafeInteger(data.unverifiedShown)||
      data.unverifiedShown!==data.unverifiedItems.length||
      !Number.isSafeInteger(data.unverifiedNotShown)||
      data.unverifiedNotShown!==data.totals.unverified-data.unverifiedShown||
      data.unverifiedItems.some(item=>!item||item.status!=='unverified'||
        typeof item.number!=='string'||!/^\d{1,10}$/.test(item.number)||
        !Number.isSafeInteger(item.checkedMs)||item.checkedMs> Date.now())||
      !data.visibleDateChecks||
      !['past','today','future','notSet','unverified']
        .every(key=>Number.isSafeInteger(data.visibleDateChecks[key])&&
          data.visibleDateChecks[key]>=0)||
      Object.values(data.visibleDateChecks).reduce((a,b)=>a+b,0)!==data.shown||
      data.items.some(item=>!['past','today','future','not_set','unverified']
        .includes(item?.plannedDateControl))||
      !Number.isSafeInteger(data.remainingRowsNotShown)||
      data.remainingRowsNotShown!==data.totals.incomplete-data.shown)
      throw Error('invalid_ms_auto_status');
    reset();
    const passed=data.completeHistoricalPass;
    const monitor={
      not_started:'Фоновый сканер ещё не подтвердил первый успешный запуск',
      on_schedule:'Фоновая синхронизация выполнялась в последние 20 минут',
      delayed:'Внимание: нет успешной синхронизации более 20 минут',
      stopped:'Внимание: фоновая синхронизация остановлена'
    }[data.monitorHealth];
    const full=data.totalAtStart===null?'пока не известно':fmt(data.totalAtStart);
    const state={
      new:'Не запущено',scanning:'Идёт ограниченный исторический обход',
      pass_complete:'Завершён проход по историческому реестру',
      paused:'Проверка приостановлена',error:'Ошибка сканера'
    }[data.scanState];
    status.textContent=monitor+'. '+state+'. Проверено в текущем поколении: '+
      fmt(data.totals.checked)+' из '+full+
      '. Это исторический реестр, а не все активные заказы.';
    details.textContent='Этапы: незавершённые '+fmt(data.totals.incomplete)+
      ', завершённые '+fmt(data.totals.complete)+
      ', не подтверждены '+fmt(data.totals.unverified)+
      '. Проход '+(passed?'отмечен завершённым':'не завершён или не подтверждён')+
      '. Последний успешный пакет: '+
      (data.lastSuccessMs?clock(data.lastSuccessMs):'ещё не выполнялся')+
      '. Актуальность: '+(data.freshness==='recent'?'менее 24 часов':
      data.freshness==='stale'?'устарело':'нет данных')+
      (data.lastErrorCode?'. Код остановки: '+data.lastErrorCode:'')+
      '. Без подтверждения активного статуса эти данные нельзя использовать для планирования загрузки цеха.';
    const drift=data.generationDrift;
    if(drift!==null&&drift!==undefined){
      if(drift.comparisonScope!=='OVERLAPPING_HISTORICAL_ROWS_NOT_LIVE_QUEUE'||
        !Number.isSafeInteger(drift.baselineGeneration)||
        drift.baselineGeneration!==data.generation-1||
        !['baselineRows','comparedRows','matchedRows','newSinceBaseline',
          'sourceUpdatedRows','stageChangedRows']
          .every(k=>Number.isSafeInteger(drift[k])&&drift[k]>=0)||
        drift.comparedRows!==data.totals.checked||
        drift.matchedRows+drift.newSinceBaseline!==drift.comparedRows||
        drift.matchedRows>drift.baselineRows||
        drift.sourceUpdatedRows>drift.matchedRows||
        drift.stageChangedRows>drift.matchedRows)
        throw Error('invalid_ms_generation_drift');
      details.textContent+=' Сравнение с предыдущим историческим проходом №'+
        drift.baselineGeneration+': совпадающих документов '+
        fmt(drift.matchedRows)+', новых относительно прошлого прохода '+
        fmt(drift.newSinceBaseline)+', изменена дата обновления у '+
        fmt(drift.sourceUpdatedRows)+', изменён статус этапов у '+
        fmt(drift.stageChangedRows)+
        '. Это только пересечение исторических проходов, не полная живая очередь.';
    }
    const dates=data.visibleDateChecks;
    attention.textContent='Среди '+fmt(data.shown)+' показанных подтверждённо незавершённых: '+
      'плановая дата прошла — '+fmt(dates.past)+
      ', сегодня — '+fmt(dates.today)+
      ', не задана — '+fmt(dates.notSet)+
      ', не подтверждена — '+fmt(dates.unverified)+
      '. Это контроль календарной даты только в показанной исторической выборке, не договорная просрочка и не вся очередь.';
    const riskOrder={past:0,today:1,not_set:2,unverified:3,future:4};
    const ordered=[...data.items].sort((a,b)=>
      riskOrder[a.plannedDateControl]-riskOrder[b.plannedDateControl]||
      (a.plannedDate||'').localeCompare(b.plannedDate||'')||
      a.number.localeCompare(b.number));
    const dateText={
      past:'Плановая дата прошла',today:'Плановый день сегодня',
      future:'Дата впереди',not_set:'Дата не задана',
      unverified:'Дата не подтверждена'
    };
    for(const item of ordered){
      if(!item||typeof item.number!=='string'||!/^\d{1,10}$/.test(item.number)||
        item.status!=='incomplete')throw Error('invalid_ms_auto_row');
      const row=document.createElement('tr');
      if(item.plannedDateControl==='past')row.className='ms-auto-overdue';
      taskLink(row,item.number);
      td(row,typeof item.remaining==='number'?fmt(item.remaining):'Не подтверждено');
      td(row,typeof item.firstUnfinishedStage==='string'?
        item.firstUnfinishedStage:'Не подтверждено');
      td(row,typeof item.plannedDate==='string'?
        item.plannedDate:'Не указана');
      td(row,dateText[item.plannedDateControl]);
      td(row,Number.isSafeInteger(item.checkedMs)?clock(item.checkedMs):'Неизвестно');
      body.append(row);
    }
    table.hidden=data.items.length===0;
    unknown.hidden=data.unverifiedItems.length===0;
    unknownSummary.textContent=
      'Эти документы нельзя считать ни завершёнными, ни незавершёнными до проверки этапов. '+
      'Показано '+fmt(data.unverifiedItems.length)+' из '+
      fmt(data.totals.unverified)+' в текущем историческом поколении. '+
      'Номера получены автоматически, данные «МойСклад» не изменялись.';
    for(const item of data.unverifiedItems){
      const row=document.createElement('tr');
      taskLink(row,item.number);
      td(row,typeof item.documentUpdated==='string'?
        item.documentUpdated:'Дата изменения неизвестна');
      td(row,typeof item.plannedDate==='string'?
        item.plannedDate:'Не указана');
      td(row,clock(item.checkedMs));
      td(row,'Этапы не подтверждены');
      unknownBody.append(row);
    }
    if(data.totals.incomplete>data.items.length)
      details.textContent+=' Отображены первые '+fmt(data.items.length)+
        ' из '+fmt(data.totals.incomplete)+' исторически незавершённых.';
  };
  const load=async()=>{
    if(!inView()||running)return;
    running=true;lastAttempt=Date.now();retry.disabled=true;reset();
    status.textContent='Проверяем результаты сохранённого фонового мониторинга…';
    try{
      const response=await fetch('/api/ms/production-auto-status',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(15000)
      });
      const data=await response.json();
      if(!response.ok){
        const code=typeof data?.code==='string'&&
          /^[a-z][a-z0-9_]{0,65}$/.test(data.code)?
          data.code:'ms_auto_read_unavailable';
        status.textContent=code==='ms_auto_storage_not_configured'?
          'Фоновый мониторинг ещё не подключён к выделенной базе. Автоматическая проверка последних обновлённых заданий выше продолжает работать.':
          'Невозможно подтвердить сохранённые данные: '+code+'. Никаких статусов не предполагаем.';
      }else show(data);
    }catch{
      reset();
      status.textContent='Данные фонового мониторинга недоступны. Не считаем их нулевыми или завершёнными.';
    }finally{running=false;retry.disabled=false;}
  };
  const maybeLoad=()=>{
    if(inView()&&!running&&Date.now()-lastAttempt>=EVERY_MS)void load();
  };
  retry.addEventListener('click',()=>{if(!running)void load();});
  window.addEventListener('hashchange',maybeLoad);
  document.addEventListener('visibilitychange',maybeLoad);
  window.setInterval(maybeLoad,60*1000);
  maybeLoad();
})();
