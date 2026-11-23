import {createSourceRegistry,renderSourceRegistry} from './office-source-registry.mjs';
/* AutoСклад63 CEO board: protected source summaries, read-only, fail-closed. */
const byId=id=>document.getElementById(id);
const validInt=x=>Number.isSafeInteger(x);
const count=x=>validInt(x)&&x>=0?new Intl.NumberFormat('ru-RU').format(x):'Нет подтверждения';
const money=x=>validInt(x)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(x/100):'Нет подтверждения';
const set=(id,value)=>{const node=byId(id);if(node)node.textContent=String(value);};
const prevMonth=()=>{const d=new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)).toISOString().slice(0,7);};
const monthOk=m=>/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(m||'');
const closed=m=>monthOk(m)&&new Date(m+'-01T00:00:00Z').getTime()<new Date(new Date().toISOString().slice(0,7)+'-01T00:00:00Z').getTime();
function status(id,label,kind='neutral'){
  const el=byId(id);if(!el)return;
  el.textContent=label;el.dataset.state=kind;
}
async function jsonGet(path,ms=16000){
  const response=await fetch(path,{method:'GET',credentials:'same-origin',
    cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(ms)});
  if(!response.ok)throw Error(response.status===401||response.status===403?'auth':'unavailable');
  const data=await response.json();
  if(!data||typeof data!=='object')throw Error('schema');
  return data;
}
const messages={auth:'Требуется вход владельца',unavailable:'Источник недоступен',schema:'Ответ не подтверждён'};
function unavailable(prefix,error){
  const msg=messages[error?.message]||'Нет подтверждённых данных';
  const source={ceoOzon:'ozon',ceoWb:'wb',ceoProduction:'moysklad',ceoMsQueue:'msqueue',ceoAds:'ozonads'}[prefix];
  if(source)reportSource(source,'blocked',msg);
  status(prefix+'State',msg,'warning');
  set(prefix+'Note','Нет данных для безопасного вывода. Откройте подробный раздел.');
  if(prefix==='ceoOzon'){
    set('ceoOzonAuditValue','Нет данных');
    status('ceoOzonAuditState',msg,'warning');
    set('ceoOzonAuditNote','Загрузка и сверка сумм Ozon не подтверждены.');
    set('ceoOzonProfitValue','Не подтверждена');
    status('ceoOzonProfitState',msg,'warning');
    set('ceoOzonProfitNote','Без подтверждённой финансовой базы чистую прибыль рассчитать нельзя.');
  }
}
const sourceRegistry=createSourceRegistry();
function reportSource(id,status,detail){
  sourceRegistry.update(id,{status,detail,checkedAt:Date.now()});
  renderSourceRegistry(byId('ceoSourceRegistry'),sourceRegistry.snapshot());
}
function showProduction(data){
  if(data.code!=='ms_production_auto_status_ok'||data.readOnly!==true||
     data.approvedForLiveQueue!==false||!validInt(data.totals?.checked)||
     !validInt(data.totals?.incomplete)||!validInt(data.totals?.unverified)||
     data.totals.checked<0||data.totals.incomplete<0||
     data.totals.unverified<0||data.totals.incomplete>data.totals.checked)
     throw Error('schema');
  const snap=data.completedHistoricalSnapshot;
  const complete=snap&&
    snap.scope==='COMPLETED_HISTORICAL_PASS_NOT_LIVE_ACTIVE_QUEUE'&&
    ['generation','checked','incomplete','complete','unverified','lastCheckedMs']
      .every(k=>validInt(snap[k])&&snap[k]>=0)&&
    snap.checked>0&&
    snap.checked===snap.incomplete+snap.complete+snap.unverified&&
    snap.lastCheckedMs>0&&snap.lastCheckedMs<=Date.now();
  // A complete historic scan is an actual finished technical milestone,
  // not a verified active production backlog or a shop-floor dispatch queue.
  if(complete){
    reportSource('moysklad','partial','Фоновый обход завершён: '+
      count(snap.checked)+' документов; живая очередь ещё не подтверждена');
    set('ceoProductionValue',count(snap.checked)+' / '+count(snap.checked));
    status('ceoProductionState','Автоматический обход реестра выполнен','success');
    set('ceoProductionNote','Подтверждён полный исторический проход №'+
      count(snap.generation)+': '+count(snap.incomplete)+
      ' незавершённых этапов, '+count(snap.unverified)+
      ' требуют уточнения. Текущий проход №'+count(data.generation)+
      ': '+count(data.totals.checked)+' проверено. Это не список действующих заказов.');
    set('ceoProductionWarning','Обход реестра работает автоматически. '+
      'Отдельный этап — подтверждение текущих заказов и распределение по цехам.');
  }else{
    reportSource('moysklad','partial','Фоновый исторический обход: '+
      count(data.totals.checked)+' документов; полный проход не подтверждён');
    set('ceoProductionValue',count(data.totals.checked));
    status('ceoProductionState','Идёт исторический обход · не живая очередь','warning');
    set('ceoProductionNote','Проверено в текущем проходе: '+
      count(data.totals.checked)+'; неизвестный этап у '+
      count(data.totals.unverified)+'. Полный проход не подтверждён.');
    set('ceoProductionWarning','Текущая выборка не равна всей очереди цеха.');
  }
  reportSource('inventory','partial','Остатки двух складов требуют отдельной сверки');
}
function showProductionQueue(data){
  const counts=data?.counts;
  const valid=data?.code==='ms_production_queue_candidates_ok'&&
    data.readOnly===true&&data.changedRecords===0&&
    data.approvedForDispatch===false&&
    data.scope==='HISTORICAL_CANDIDATES_NEED_LIVE_STAGE_AND_ORDER_VERIFICATION'&&
    data.completeHistoricalCoverage===true&&
    data.monitorHealthy===true&&
    validInt(counts?.incomplete)&&counts.incomplete>=0&&
    validInt(counts?.unverified)&&counts.unverified>=0&&
    validInt(data.shown)&&data.shown>=0&&
    validInt(data.additionalCandidatesNotShown)&&
    data.additionalCandidatesNotShown>=0&&
    Array.isArray(data.items)&&data.items.length===data.shown&&
    data.shown+data.additionalCandidatesNotShown===
      counts.incomplete+counts.unverified&&
    validInt(data.lastSuccessMs)&&data.lastSuccessMs>0&&
    data.lastSuccessMs<=Date.now();
  if(!valid)throw Error('schema');
  const n=counts.incomplete+counts.unverified;
  const label='Очередь проверки сформирована';
  reportSource('msqueue','verified',
    'Автоматическая очередь кандидатов: '+count(n)+
    '; история сверена. Действующие заказы отдельно не подтверждены');
  set('ceoMsQueueValue',count(n));
  status('ceoMsQueueState',label,'success');
  set('ceoMsQueueNote','Из истории обнаружено: '+count(counts.incomplete)+
    ' с незавершёнными этапами и '+count(counts.unverified)+
    ' с неподтверждёнными. Это не живая очередь цеха и не назначения.');
}
function showWB(data){
  if(data.code!=='wb_api_sync_status'||
    data.source!=='WB_FINANCE_API_D1'||
    data.readOnly!==true||data.changedRecords!==0||
    data.netProfitStatus!=='NOT_CALCULATED'||
    data.sumScope!=='API_COMPLETED_REPORTS_ONLY_DO_NOT_ADD_XLSX')
    throw Error('schema');
  if(!validInt(data.reportCount)||data.reportCount<0||
    !validInt(data.completedCount)||data.completedCount<0||
    data.completedCount>data.reportCount||
    !validInt(data.mismatchCount)||!validInt(data.conflictCount)||
    !validInt(data.failedCount)||!validInt(data.queuedCount)||
    !validInt(data.totalBankPaymentKop))throw Error('schema');
  reportSource('wb','partial',count(data.completedCount)+' из '+count(data.reportCount)+' финансовых отчётов обработано; прибыль не рассчитана');
  set('ceoWbValue',count(data.completedCount)+' / '+count(data.reportCount));
  const issues=data.mismatchCount+data.conflictCount+data.failedCount;
  const allReportsLoaded=data.reportCount>0&&
    data.completedCount===data.reportCount&&
    data.queuedCount===0&&issues===0;
  status('ceoWbState',
    issues?'Есть расхождения: '+count(issues):
      allReportsLoaded?'Все API-отчёты загружены · прибыль отдельно':
      'Монитор отчётов · только сохранённые',
    issues?'danger':allReportsLoaded?'success':'neutral');
  const evidence=Array.isArray(data.payoutDifferenceEvidence)?
    data.payoutDifferenceEvidence.filter(e=>
      e?.status==='PAYOUT_DIFFERENCE_EXACTLY_PAID_ACCEPTANCE'&&
      e.correctionApplied===false&&
      typeof e.reportId==='string'&&/^\\d{1,20}$/.test(e.reportId)&&
      validInt(e.differenceKop)&&e.differenceKop>0&&
      e.differenceKop===e.paidAcceptanceKop&&
      validInt(e.rowCount)&&e.rowCount>0).slice(0,3):[];
  const explanation=evidence.length?
    ' Найдена причина расхождения: отчёт №'+evidence[0].reportId+
      ', '+money(evidence[0].differenceKop)+
      ' платной приёмки не учтено в прежнем расчёте. '+
      'Причина подтверждена строками, исправление отчёта ещё не выполнено.':'';
  set('ceoWbNote','Выплаты по завершённым отчётам: '+money(data.totalBankPaymentKop)+
    '. Ожидают обработки: '+count(data.queuedCount)+
    '. Выплата не равна прибыли.'+explanation);
}
function showOzon(data){
  const p=data?.result;
  if(!p||typeof p!=='object')throw Error('schema');
  showOzonFinanceAudit(data.readiness);
  const report=p.report;
  set('ceoOzonValue',validInt(report?.salesKopecks)?
    money(report.salesKopecks):'Нет подтверждения');
  status('ceoOzonState',validInt(report?.salesKopecks)?
    'Продажи по XLSX · прибыль отдельно':'Продажи не подтверждены',
    validInt(report?.salesKopecks)?'neutral':'warning');
  set('ceoOzonNote','Выручка из отчёта Ozon за выбранный месяц. '+
    'Это не выплата, не сумма начислений и не чистая прибыль.');
  const close=p.financeCloseout,profit=p.profit;
  if(!close||close.readOnly!==true||close.changedRecords!==0||
    !Array.isArray(close.missing)||!Array.isArray(profit?.blockers)||
    close.netProfitVerified!==false)
    throw Error('invalid_profit_closeout');
  const hasCost=p.dateCostEvidence?.complete===true&&
    p.dateCostEvidence.checkedSalesRows>0&&
    p.dateCostEvidence.checkedSalesRows===
      p.dateCostEvidence.confirmedSalesRows;
  const meaning={
    advertisingSourceReconciled:'сверить рекламные начисления',
    taxRegisterAudited:'подтвердить налоговый регистр',
    bankStatementReconciled:'сверить банк',
    expenseAllocationCalculated:'распределить общие расходы',
    returnTreatmentReviewed:'проверить возвраты',
    apiDetailReconciled:'проверить состав начислений',
    reportSourceVerified:'подтвердить первичный отчёт'
  };
  const pending=close.missing.map(x=>meaning[x]||String(x)
    .replace(/([A-Z])/g,' $1').toLowerCase()).slice(0,7);
  set('ceoOzonProfitValue','Не подтверждена');
  status('ceoOzonProfitState','Не закрыто: '+close.missing.length+
    ' обязательных проверок','warning');
  set('ceoOzonProfitNote',
    (hasCost&&validInt(profit?.grossKopecks)?
      'Предварительный валовой результат, не чистая прибыль: '+
        money(profit.grossKopecks)+'. ':'')+
    'Осталось: '+(pending.length?pending.join('; '):
      'полная независимая сверка')+'. '+
    'Неподтверждённые суммы не утверждаются автоматически.');
  reportSource('ozon','partial',
    'Продажи загружены; чистая прибыль не подтверждена');
}

function showOzonFinanceAudit(data){
  if(data?.code!=='ozon_finance_readiness'||data.readOnly!==true||
    data.source!=='CANONICAL_OZON_FINANCE_SYNC'||
    data.netProfitVerified!==false||data.changedRecords!==0||
    !Array.isArray(data.blockers)||!data.accruals||!data.cogs||
    !data.sourcesMatch)throw Error('schema');
  const r=data.report,a=data.accruals,c=data.cogs;
  if(![a.rows,a.coveredDays,a.expectedDays,c.soldSkus,
    c.confirmedSoldSkus,c.confirmedEntries,
    c.checkedSalesRows,c.confirmedSalesRows].every(x=>validInt(x)&&x>=0)||
    !validInt(a.totalKop)||c.confirmedSoldSkus>c.soldSkus||
    c.confirmedSalesRows>c.checkedSalesRows||
    a.coveredDays>a.expectedDays||
    (r&&!validInt(r.controlTotalKop)))throw Error('schema');
  const parity=data.dailyParity;
  const parityVerified=parity?.code==='ozon_daily_totals_parity'&&
    parity.readOnly===true&&parity.officialDetailReconciled===false&&
    parity.changedRecords===0&&parity.match===true&&
    validInt(parity.checkedDays)&&validInt(parity.expectedDays)&&
    parity.checkedDays===a.expectedDays&&
    parity.matchedDays===parity.expectedDays;
  const sourceReady=r?.complete===true&&
    a.coveredDays===a.expectedDays&&
    data.sourcesMatch.apiVsXlsxKopecks===true&&
    parityVerified;
  set('ceoOzonAuditValue',a.coveredDays+' / '+a.expectedDays+' дней');
  status('ceoOzonAuditState',
    sourceReady?'API и XLSX по месяцу совпадают · прибыль отдельно':
      'Источник не подтверждён: требуется сверка',
    sourceReady?'success':'warning');
  const reconciliation=data.reconciliation;
  if(!reconciliation||!validInt(reconciliation.checkedDays)||
    !validInt(reconciliation.detailVerifiedDays)||
    reconciliation.detailVerifiedDays>reconciliation.checkedDays||
    reconciliation.aggregateParityIsNotDetailReconciliation!==true)
    throw Error('schema');
  set('ceoOzonAuditNote',
    'Finance API: '+count(a.rows)+' начислений за '+
    a.coveredDays+'/'+a.expectedDays+' дней. XLSX: '+
    (r?count(r.records):'нет')+' строк. '+
    (data.sourcesMatch.apiVsXlsxKopecks?
      'Итог за месяц совпадает: '+money(a.totalKop)+'. ':
      'Итог месяца не сверен. ')+
    'Дневные итоги: '+(parityVerified?
      parity.matchedDays+'/'+parity.expectedDays+' совпали. ':
      'сверка не подтверждена. ')+
    'Это проверка сумм, не прибыли. '+
    'Состав начислений: '+reconciliation.detailVerifiedDays+
    '/'+reconciliation.checkedDays+' дней; '+
    'себестоимость: '+c.confirmedSalesRows+'/'+
    c.checkedSalesRows+' строк продаж.');

}

function showAds(data){
  const audit=data.columnAudit,fin=data.financeAudit;
  if(data.code!=='ozon_ads_office_preview'||data.readOnly!==true||
     data.monetaryTotalsVerified!==false||data.reconciledToFinance!==false||
     !Array.isArray(audit)||!fin||fin.reconciled!==false||
     fin.source!=='CANONICAL_OZON_FINANCE_XLSX'||
     fin.matchedToPerformance!==false||
     fin.deductedFromProfit!==false)throw Error('schema');
  const m=audit.find(x=>x?.field==='moneySpent');
  if(!m||!validInt(m.validRows)||!validInt(data.recordCount)||
    m.validRows!==data.recordCount||!validInt(m.rawColumnSumKopecks)||
    !validInt(fin.advertisingAccrualKopecks))throw Error('schema');
  reportSource('ozonads','partial','Performance API ответил; рекламные суммы с Finance не сверены');
  set('ceoAdsValue',money(m.rawColumnSumKopecks));
  status('ceoAdsState','Не сверено с Finance','warning');
  set('ceoAdsNote','Performance: '+count(data.recordCount)+
    ' строк; сумма предварительная. Рекламные начисления из основного XLSX Ozon: '+
    money(fin.advertisingAccrualKopecks)+' ('+count(fin.advertisingRows)+' строк). '+
    (fin.sourceTotalsMatched?
      'Общий итог XLSX сверен с Finance API. ':
      'Общий итог XLSX с Finance API не подтверждён. ')+
    'Эти два источника нельзя складывать или повторно вычитать из прибыли.');
}
function showOzonOrdersReadiness(data){
  if(data?.code!=='ozon_orders_readiness'||data.readOnly!==true||
    data.changedRecords!==0||typeof data.ready!=='boolean'||
    typeof data.checkedAt!=='string')throw Error('invalid_readiness');
  if(data.ready===true&&data.status==='verified'&&data.http===200&&
    Number.isSafeInteger(data.checkedSample)&&
    data.checkedSample>=0&&data.checkedSample<=1){
    set('ceoOzonOrdersValue','API работает');
    status('ceoOzonOrdersState','Чтение Ozon подтверждено','success');
    set('ceoOzonOrdersNote','Проверено: '+data.checkedAt.slice(0,16).replace('T',' ')+
      ' UTC. Проверка только чтения FBO; импорт в «МойСклад» остаётся отдельным этапом.');
  }else{
    set('ceoOzonOrdersValue','Не подтверждено');
    status('ceoOzonOrdersState','Доступ к заказам не подтверждён','warning');
    set('ceoOzonOrdersNote','Причина: '+({
      permission_denied:'права API',
      token_rejected:'авторизация Ozon',
      rate_limited:'лимит запросов',
      upstream_error:'ответ API',
      unverified_response:'формат/доступность ответа'
    }[data.status]||'неизвестно')+'. Никаких записей нет.');
  }
}
function reset(){
  for(const p of ['ceoOzon','ceoOzonAudit','ceoOzonProfit','ceoOzonOrders','ceoWb','ceoProduction','ceoMsQueue','ceoAds'])
    {set(p+'Value','Загрузка…');status(p+'State','Читаем источник');set(p+'Note','');}
  set('ceoProfitValue','Не подтверждена');set('ceoProductionWarning','');
}
let busy=false,lastRead=0;
async function refresh(){
  if(busy)return;
  const month=byId('ceoMonth')?.value;
  if(!closed(month)){status('ceoOverallState','Выберите завершённый месяц','warning');return;}
  busy=true;const btn=byId('ceoRefresh');if(btn)btn.disabled=true;
  lastRead=Date.now();reset();
  status('ceoOverallState','Проверяем источники','neutral');
  const sources=[
    ['ceoOzon','/api/ozon/profit?month='+encodeURIComponent(month),showOzon],
    ['ceoOzonOrders','/api/ozon/orders-readiness',showOzonOrdersReadiness],
    ['ceoWb','/api/wb/auto-sync-status',showWB],
    ['ceoProduction','/api/ms/production-auto-status',showProduction],
    ['ceoMsQueue','/api/ms/production-queue',showProductionQueue]
  ];
  let confirmed=0;
  await Promise.all(sources.map(async([key,url,paint])=>{
    try{paint(await jsonGet(url));confirmed++;}
    catch(e){unavailable(key,e);set(key+'Value','Нет данных');}
  }));
  // Ozon advertising is deliberately on-demand because it calls Ozon OAuth
  // and the external Performance API, which can rate-limit.
  set('ceoAdsValue','По запросу');
  status('ceoAdsState','Не загружено: внешний API','neutral');
  set('ceoAdsNote','Нажмите «Проверить рекламу» для выбранного месяца. '+ 
    'Прибыль не меняется.');
  const now=new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Samara'}).format(new Date());
  set('ceoUpdated','Проверено: '+now+' · '+confirmed+' из '+sources.length+' внутренних источников');
  status('ceoOverallState',confirmed===sources.length?
    'Данные загружены · финансовое закрытие не подтверждено':
    'Есть неподтверждённые источники','warning');
  busy=false;if(btn)btn.disabled=false;
}
async function refreshAds(){
  const month=byId('ceoMonth')?.value;
  if(!closed(month))return;
  const btn=byId('ceoAdsRefresh');if(btn)btn.disabled=true;
  status('ceoAdsState','Проверяем Performance API','neutral');
  try{showAds(await jsonGet('/api/ozon/ads-expense?month='+encodeURIComponent(month),25000));}
  catch(e){unavailable('ceoAds',e);set('ceoAdsValue','Нет подтверждения');}
  finally{if(btn)btn.disabled=false;}
}
function visible(){return !byId('ceoBoard')?.closest('[data-section]')?.hidden;}
function maybeRefresh(){
  if(visible()&&!busy&&(Date.now()-lastRead>5*60*1000))void refresh();
}
if(typeof document!=='undefined'){
  const month=byId('ceoMonth');
  if(month){
    month.value=prevMonth();
    month.addEventListener('change',()=>{lastRead=0;void refresh();});
    byId('ceoRefresh')?.addEventListener('click',()=>{lastRead=0;void refresh();});
    byId('ceoAdsRefresh')?.addEventListener('click',refreshAds);
    window.addEventListener('hashchange',maybeRefresh);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')maybeRefresh();});
    renderSourceRegistry(byId('ceoSourceRegistry'),sourceRegistry.snapshot());
    maybeRefresh();
  }
}
