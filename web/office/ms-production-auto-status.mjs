// Auto-read the dedicated production monitor's historical scan status.
// It never starts a scan, writes to D1 or requests MoySklad directly.
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const root=el('msAutoHistory'),status=el('msAutoHistoryStatus');
  const details=el('msAutoHistoryDetails'),table=el('msAutoHistoryTable');
  const body=el('msAutoHistoryRows'),retry=el('msAutoHistoryRetry');
  if([root,status,details,table,body,retry].some(x=>!x))return;
  const EVERY_MS=30*60*1000;
  const fmt=n=>new Intl.NumberFormat('ru-RU').format(n);
  const clock=n=>new Intl.DateTimeFormat('ru-RU',{
    dateStyle:'short',timeStyle:'short',timeZone:'Europe/Samara'
  }).format(new Date(n));
  const td=(row,value)=>{
    const cell=document.createElement('td');
    cell.textContent=String(value);row.append(cell);
  };
  let running=false,lastAttempt=0;
  const inView=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#production';
  const reset=()=>{body.replaceChildren();table.hidden=true;details.textContent='';};
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
    for(const item of data.items){
      if(!item||typeof item.number!=='string'||!/^\d{1,10}$/.test(item.number)||
        item.status!=='incomplete')throw Error('invalid_ms_auto_row');
      const row=document.createElement('tr');
      td(row,item.number);
      td(row,typeof item.remaining==='number'?fmt(item.remaining):'Не подтверждено');
      td(row,typeof item.firstUnfinishedStage==='string'?
        item.firstUnfinishedStage:'Не подтверждено');
      td(row,typeof item.plannedDate==='string'?
        item.plannedDate:'Не указана');
      td(row,Number.isSafeInteger(item.checkedMs)?clock(item.checkedMs):'Неизвестно');
      body.append(row);
    }
    table.hidden=data.items.length===0;
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
