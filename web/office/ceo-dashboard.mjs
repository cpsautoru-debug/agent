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
  const source={ceoOzon:'ozon',ceoWb:'wb',ceoProduction:'moysklad',ceoAds:'ozonads'}[prefix];
  if(source)reportSource(source,'blocked',msg);
  status(prefix+'State',msg,'warning');
  set(prefix+'Note','Нет данных для безопасного вывода. Откройте подробный раздел.');
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
  status('ceoWbState',issues?'Есть расхождения: '+count(issues):'Монитор отчётов · только сохранённые',issues?'danger':'neutral');
  set('ceoWbNote','Выплаты по завершённым отчётам: '+money(data.totalBankPaymentKop)+
    '. Ожидают обработки: '+count(data.queuedCount)+
    '. Выплата не равна прибыли.');
}
function showOzon(data){
  const p=data.result;
  if(!p||typeof p!=='object')throw Error('schema');
  const net=p.profit?.netEstimateKopecks,report=p.report;
  set('ceoOzonValue',validInt(report?.salesKopecks)?
    money(report.salesKopecks):'Нет подтверждения');
  const c=p.financeCloseout;
  const verified=c?.netProfitVerified===true&&c?.bankStatementVerified===true;
  reportSource('ozon',verified?'verified':'partial',verified?'Период закрыт и сверен':'Оценка прибыли, полный финансовый период не закрыт');
  status('ceoOzonState',verified?'Период подтверждён':'Прибыль НЕ подтверждена',verified?'success':'warning');
  set('ceoOzonNote','Оценка чистой прибыли: '+(validInt(net)?money(net):'неизвестно')+
    '. Полная сверка операций, возвратов, рекламы и банка обязательна.');
  set('ceoProfitValue',verified&&validInt(net)?money(net):'Не подтверждена');
}
function showAds(data){
  const audit=data.columnAudit,fin=data.financeAudit;
  if(data.code!=='ozon_ads_office_preview'||data.readOnly!==true||
     data.monetaryTotalsVerified!==false||data.reconciledToFinance!==false||
     !Array.isArray(audit)||!fin||fin.reconciled!==false)throw Error('schema');
  const m=audit.find(x=>x?.field==='moneySpent');
  if(!m||!validInt(m.validRows)||!validInt(data.recordCount)||
    m.validRows!==data.recordCount||!validInt(m.rawColumnSumKopecks)||
    !validInt(fin.advertisingAccrualKopecks))throw Error('schema');
  reportSource('ozonads','partial','Performance API ответил; рекламные суммы с Finance не сверены');
  set('ceoAdsValue',money(m.rawColumnSumKopecks));
  status('ceoAdsState','Не сверено с Finance','warning');
  set('ceoAdsNote','Performance: '+count(data.recordCount)+' строк. Отдельные начисления D1: '+
    money(fin.advertisingAccrualKopecks)+'. Разница не означает задолженность. '+ 
    'Бонусы не прибавляются к денежным расходам автоматически.');
}
function reset(){
  for(const p of ['ceoOzon','ceoWb','ceoProduction','ceoAds'])
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
    ['ceoWb','/api/wb/auto-sync-status',showWB],
    ['ceoProduction','/api/ms/production-auto-status',showProduction]
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
