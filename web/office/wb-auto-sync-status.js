// WB finance monitor: owner-only D1 reads. NEVER issues requests to WB Finance,
// calls sync-once, modifies reports, or treats API payouts as net profit.
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const button=el('wbAutoSyncRefresh'),status=el('wbAutoSyncStatus');
  const root=el('wbAutoSyncPanel'),allRows=el('wbAutoSyncRows'),
    queueRows=el('wbMonitorQueueRows'),issueRows=el('wbMonitorIssueRows'),
    warnings=el('wbMonitorWarnings'),filter=el('wbMonitorFilter');
  const ids=['wbMonitorHealth','wbMonitorReports','wbMonitorComplete',
    'wbMonitorQueue','wbMonitorIssues','wbMonitorOperations',
    'wbMonitorPercent','wbMonitorProgress','wbMonitorLastRequest',
    'wbMonitorLastChange','wbMonitorPayout','wbMonitorWindow',
    'wbMonitorQueueCount','wbMonitorIssuesCount','wbMonitorAllCount'];
  if(!root||![button,status,allRows,queueRows,issueRows,warnings,filter]
    .every(Boolean)||ids.some(id=>!el(id)))return;

  const n=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
  const money=x=>new Intl.NumberFormat('ru-RU',{
    style:'currency',currency:'RUB'
  }).format(x/100);
  const time=x=>new Intl.DateTimeFormat('ru-RU',{
    dateStyle:'short',timeStyle:'short',timeZone:'Europe/Samara'
  }).format(new Date(x));
  const parseSqlUtc=value=>{
    if(typeof value!=='string'||!/^20\d\d-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value))
      return null;
    const ms=Date.parse(value.replace(' ','T')+'Z');
    return Number.isFinite(ms)?ms:null;
  };
  const statusNames={
    pending:'Ожидает',paging:'Идёт загрузка',complete:'Сверен',
    mismatch:'Расхождение',conflict:'Конфликт',failed:'Ошибка'
  };
  const healthNames={
    on_schedule:'По расписанию',starting_window:'Начало окна Cron',
    outside_window:'Вне окна Cron',never_started:'Не запускался',
    delayed:'Задержка синхронизации',halted:'Синхронизация остановлена',
    clock_error:'Несовпадение времени'
  };
  const jobNames={
    report_complete:'Завершён отчёт',report_mismatch:'Расхождение выплаты',
    list_complete:'Список получен',list_paging:'Идёт чтение списка',
    page_received:'Страница операций сохранена',
    up_to_date:'Очередь обработана по имеющемуся списку',
    throttled:'Запуск пропущен из-за ограничения частоты',
    never_run:'Ещё не запускался'
  };
  const labels={
    SYNC_HALTED:'Автоматическая загрузка остановлена сервером. Требуется проверка причины.',
    SYNC_DELAYED:'Во время утреннего окна Cron более 20 минут не было подтверждённого запуска.',
    SYNC_CLOCK_ERROR:'Время последнего запроса некорректно; проверьте часы сервера.',
    PAYOUT_MISMATCH:'Есть отчёты с расхождением выплат — требуется сверка.',
    SOURCE_CONFLICT:'Данные ранее сохранённых отчётов изменились: обнаружен конфликт источника.',
    REPORT_FAILED:'В базе есть отчёты со статусом ошибки.'
  };
  const cell=(tr,value)=>{
    const td=document.createElement('td');
    td.textContent=String(value);tr.append(td);return td;
  };
  const row=(values,tbody,problem=false)=>{
    const tr=document.createElement('tr');
    if(problem)tr.className='wb-monitor-error-row';
    values.forEach(v=>cell(tr,v));
    tbody.append(tr);
  };
  const empty=(tbody,msg)=>{
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.textContent=msg;td.colSpan=8;tr.append(td);tbody.append(tr);
  };
  const emptySummary=()=>{
    for(const id of ['wbMonitorHealth','wbMonitorReports','wbMonitorComplete',
      'wbMonitorQueue','wbMonitorIssues','wbMonitorOperations',
      'wbMonitorPercent','wbMonitorQueueCount','wbMonitorIssuesCount',
      'wbMonitorAllCount'])el(id).textContent='—';
    el('wbMonitorProgress').value=0;
    for(const id of ['wbMonitorLastRequest','wbMonitorLastChange',
      'wbMonitorPayout'])el(id).textContent='Данные не подтверждены.';
    for(const body of [allRows,queueRows,issueRows])body.replaceChildren();
    warnings.replaceChildren();
  };
  let pending=false,lastAttempt=0,latest=null;
  const visible=()=>document.visibilityState==='visible'&&
    location.hash.split('/')[0]==='#wbFinance';

  // Validate all data the client uses. Never display a successful report
  // status when server returned an incomplete or invalid D1 snapshot.
  function validate(data){
    const names=['pending','paging','complete','mismatch','conflict','failed'];
    if(data?.code!=='wb_api_sync_status'||data.source!=='WB_FINANCE_API_D1'||
      data.readOnly!==true||data.changedRecords!==0||
      !Array.isArray(data.reports)||data.reports.length>300||
      !Number.isSafeInteger(data.reportCount)||
      data.reportCount!==data.reports.length||
      !Number.isSafeInteger(data.completedCount)||
      !Number.isSafeInteger(data.queuedCount)||
      !Number.isSafeInteger(data.operationsStored)||
      !Number.isSafeInteger(data.totalBankPaymentKop)||
      data.expectedIntervalMinutes!==5||
      !['healthy','attention','starting','not_started','outside_window'].includes(data.attention)||
      !Object.values({
        on_schedule:1,starting_window:1,outside_window:1,
        never_started:1,delayed:1,halted:1,clock_error:1
      }).length||!Object.hasOwn(healthNames,data.monitorHealth)||
      !Array.isArray(data.warnings)||data.warnings.some(x=>!Object.hasOwn(labels,x))||
      !data.statusCounts||names.some(k=>!Number.isSafeInteger(data.statusCounts[k])||
        data.statusCounts[k]<0)||
      names.reduce((sum,k)=>sum+data.statusCounts[k],0)!==data.reportCount||
      data.completedCount!==data.statusCounts.complete||
      data.queuedCount!==data.statusCounts.pending+data.statusCounts.paging||
      data.mismatchCount!==data.statusCounts.mismatch||
      data.conflictCount!==data.statusCounts.conflict||
      data.failedCount!==data.statusCounts.failed||
      (data.lastRequestMs!==null&&!Number.isSafeInteger(data.lastRequestMs))||
      !Number.isSafeInteger(data.asOfMs)||
      data.reports.some(x=>!x||!Object.hasOwn(statusNames,x.status)||
        typeof x.reportId!=='string'||! /^\d{1,20}$/.test(x.reportId)||
        !Number.isSafeInteger(x.rowCount)||
        !Number.isSafeInteger(x.bankPaymentKop)||
        (x.calculatedPaymentKop!==null&&!Number.isSafeInteger(x.calculatedPaymentKop))))
      throw Error('invalid_wb_finance_monitor');
  }
  function paint(data){
    validate(data);
    latest=data;
    const issueCount=data.mismatchCount+data.conflictCount+data.failedCount;
    el('wbMonitorHealth').textContent=healthNames[data.monitorHealth];
    el('wbMonitorReports').textContent=n.format(data.reportCount);
    el('wbMonitorComplete').textContent=n.format(data.completedCount);
    el('wbMonitorQueue').textContent=n.format(data.queuedCount);
    el('wbMonitorIssues').textContent=n.format(issueCount);
    el('wbMonitorOperations').textContent=n.format(data.operationsStored);
    const percent=data.reportCount?
      Math.round(data.completedCount/data.reportCount*100):0;
    el('wbMonitorPercent').textContent=data.reportCount?
      percent+'% · '+data.completedCount+' из '+data.reportCount:'Нет отчётов';
    el('wbMonitorProgress').value=percent;
    el('wbMonitorLastRequest').textContent='Последний запрос Finance API: '+
      (data.lastRequestMs?time(data.lastRequestMs):'не подтверждён')+
      ' · '+(jobNames[data.lastJobStatus]||
        (data.lastJobStatus.startsWith('halted_')?
          'Остановлен: '+data.lastJobStatus:'Последний статус: '+data.lastJobStatus));
    const changed=parseSqlUtc(data.lastStateChange);
    el('wbMonitorLastChange').textContent='Последняя запись о состоянии: '+
      (changed===null?'не подтверждена':time(changed))+
      ' · дата последнего поиска отчётов: '+(data.lastListingDate||'не подтверждена');
    el('wbMonitorPayout').textContent=
      'Банковская выплата только по '+data.completedCount+
      ' завершённым API-отчётам: '+money(data.totalBankPaymentKop)+
      '. Не является выручкой или чистой прибылью.';
    el('wbMonitorWindow').textContent=
      'Ожидаемое утреннее окно Cron: '+data.scheduledWindowSamara+
      ' (Самара), раз в '+data.expectedIntervalMinutes+
      ' минут. Наличие расписания в Cloudflare проверяется отдельно.';
    const healthy=data.attention==='healthy';
    status.className='wb-monitor-main-status'+
      (data.attention==='attention'?' wb-monitor-alert':
        healthy?' wb-monitor-ok':'');
    status.textContent=healthy?
      'Финансовая синхронизация выполнялась по расписанию. Данные D1 подтверждены.':
      data.monitorHealth==='outside_window'?
        'Сейчас вне утреннего окна Cron. Это не ошибка; данные D1 сохранены.':
        data.monitorHealth==='starting_window'?
          'Утреннее окно началось, ожидаем очередной запуск.':
          data.monitorHealth==='never_started'?
            'Успешных или начатых запросов пока нет.':
            'Нужна проверка финансового монитора: '+healthNames[data.monitorHealth]+'.';

    warnings.replaceChildren();
    for(const code of data.warnings){
      const p=document.createElement('p');
      p.className='wb-monitor-warning';
      p.textContent=labels[code];
      warnings.append(p);
    }
    if(!data.warnings.length){
      const p=document.createElement('p');
      p.textContent=data.queuedCount?
        'Сейчас '+data.queuedCount+' отчётов ещё ожидают завершения. Это очередь, а не ошибка.':
        data.reportCount?
          'По сохранённым отчётам нет статусов mismatch, conflict или failed.':
          'Отчёты пока не обнаружены. Не считайте нулевую очередь завершённой сверкой.';
      warnings.append(p);
    }
    // All three lists derive from the SAME protected D1 response.
    queueRows.replaceChildren();issueRows.replaceChildren();
    const queue=data.reports.filter(x=>x.status==='pending'||x.status==='paging');
    const issues=data.reports.filter(x=>['mismatch','conflict','failed'].includes(x.status));
    el('wbMonitorQueueCount').textContent='('+queue.length+')';
    el('wbMonitorIssuesCount').textContent='('+issues.length+')';
    el('wbMonitorAllCount').textContent=n.format(data.reportCount);
    for(const x of queue){
      row([x.reportId,x.dateFrom+' — '+x.dateTo,
        statusNames[x.status],n.format(x.rowCount)],queueRows);
    }
    for(const x of issues){
      row([x.reportId,statusNames[x.status]+
          (x.errorCode?' · '+x.errorCode:''),
        money(x.bankPaymentKop),
        x.calculatedPaymentKop===null?'Не подтверждено':money(x.calculatedPaymentKop)],
      issueRows,true);
    }
    if(!queue.length)empty(queueRows,'Нет отчётов в очереди среди сохранённых.');
    if(!issues.length)empty(issueRows,'Расхождений, конфликтов и ошибок среди сохранённых нет.');
    showReports();
  }
  function showReports(){
    if(!latest)return;
    allRows.replaceChildren();
    const selected=filter.value;
    const subset=latest.reports.filter(x=>selected==='all'||x.status===selected);
    for(const x of subset){
      row([x.reportId,x.dateFrom+' — '+x.dateTo,
        x.reportType===1?'Основной':'По выкупам',
        statusNames[x.status],money(x.bankPaymentKop),
        x.calculatedPaymentKop===null?'—':money(x.calculatedPaymentKop),
        n.format(x.rowCount),
        parseSqlUtc(x.updatedAt)===null?'—':time(parseSqlUtc(x.updatedAt))],
      allRows,['mismatch','conflict','failed'].includes(x.status));
    }
    if(!subset.length)empty(allRows,'Для выбранного фильтра нет отчётов.');
  }
  async function refresh(force=false){
    if(pending||!visible()&&!force)return;
    if(!force&&lastAttempt&&Date.now()-lastAttempt<5*60*1000)return;
    lastAttempt=Date.now();pending=true;button.disabled=true;
    status.className='wb-monitor-main-status';
    status.textContent='Читаем сохранённые данные WB из защищённой D1…';
    try{
      const response=await fetch('/api/wb/auto-sync-status',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(15000)
      });
      if(response.status===401){
        emptySummary();
        status.textContent='Войдите в онлайн-офис через Google, чтобы видеть финансовые данные WB.';
        return;
      }
      if(response.status===403){
        emptySummary();
        status.textContent='У текущего Google-аккаунта нет прав владельца на финансы.';
        return;
      }
      if(!response.ok)throw Error('wb_api_d1_unavailable');
      paint(await response.json());
    }catch{
      // Fail closed: do not leave last successful totals looking like fresh data.
      emptySummary();latest=null;
      status.className='wb-monitor-main-status wb-monitor-alert';
      status.textContent='Статус WB временно не подтверждён. Проверьте привязку WB_REPORT_SNAPSHOT_DB в Pages и обновите монитор. Данные не изменялись.';
    }finally{
      pending=false;button.disabled=false;
    }
  }
  button.addEventListener('click',()=>{void refresh(true);});
  filter.addEventListener('change',showReports);
  window.addEventListener('hashchange',()=>{void refresh();});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')void refresh();
  });
  window.addEventListener('pageshow',event=>{
    if(event.persisted)void refresh(true);
  });
  window.setInterval(()=>{void refresh();},60*1000);
  void refresh();
})();
