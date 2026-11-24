import {collectYandexConfirmedJobs}
 from './yandex-finance-audit-ui.mjs';
import {reconcileYandexSharedCosts}
 from './yandex-cost-crosswalk-core.mjs';
import {restoreYandexReportJobs} from './yandex-finance-job-cache.mjs';
import {reconcileYandexRealizationCosts,collectYandexRealizationCandidates,
 buildYandexSafeSkuEvidence}
 from './yandex-realization-cost-evidence.mjs';
import {buildYandexPreliminaryContribution}
 from './yandex-contribution-core.mjs';
import {buildYandexMonthlyEvidence} from './yandex-month-evidence.mjs';
// Matches only official October order SKUs, not every listed product.
// The page is a read-only reconciliation surface; all prices are per unit.
const knownShops={149082506:'САД',149106500:'автосклад'};
const money=v=>Number.isSafeInteger(v)?
 new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'})
 .format(v/100):'—';
const el=(doc,tag,text='')=>{
 const e=doc.createElement(tag);e.textContent=text;return e;
};
export function collectOrderSkuCandidates(audit){
 if(audit?.code!=='yandex_report_archive_audited'||!Array.isArray(audit.sheets))
  throw Error('yandex_orders_archive_incomplete');
 const candidates=new Map();
 for(const sheet of audit.sheets){
  // Only source sheets with product lines. Order-level service rows are
  // deliberately excluded from the SKU list to avoid false coverage.
  if(!/orders_and_offers_transactions\.json$/.test(sheet.sheet))continue;
  for(const x of sheet.skuCandidates||[]){
   if(!knownShops[x?.partnerId]||typeof x.shopSku!=='string'||
     !x.shopSku||x.shopSku.length>255)continue;
   const key=x.partnerId+':'+x.shopSku;
   const existing=candidates.get(key);
   if(!existing)candidates.set(key,{
    partnerId:x.partnerId,shopSku:x.shopSku,
    offerName:String(x.offerName||'').slice(0,250)});
   else if(!existing.offerName&&x.offerName)
    existing.offerName=String(x.offerName).slice(0,250);
  }
 }
 return [...candidates.values()];
}
export function attachYandexCostCrosswalk({documentRef=document,fetcher=fetch,
 storage=window.localStorage,windowRef=window}={}){
 const root=documentRef.getElementById('yandexFinanceReports');
 const monthNode=documentRef.getElementById('ceoMonth');
 const shopNode=documentRef.getElementById('yandexFinanceShop');
 if(!root||!monthNode||!shopNode)return false;
 const section=el(documentRef,'section');
 section.id='yandexCostCrosswalk';
 section.className='profit-panel yandex-cost-crosswalk';
 const head=el(documentRef,'h3','Себестоимость · единый справочник WB + Ozon');
 const status=el(documentRef,'p','Сверка будет выполнена автоматически из отчётов и подтверждённых справочников.');
 const view=el(documentRef,'div');
 section.append(head,status,view);
 const automatic=root.querySelector?.('#yandexAutoReportsStatus');
 if(automatic?.after)automatic.after(section);
 else root.prepend(section);
 let running=false,doneKey='',lastRun=0,latestCosts=null;
 let lastSnapshotKey='',lastSnapshotAttempt=0;
 let latestReportIds=new Map();
 const financeEvidence=new Map();
 function showContribution(){
  const existing=view.querySelector?.('#yandexPreliminaryContribution');
  existing?.remove();
  if(!latestCosts||latestCosts.month!==monthNode.value)return;
  const card=el(documentRef,'section');
  card.id='yandexPreliminaryContribution';
  card.className='profit-panel';
  card.append(el(documentRef,'h4',
   'Промежуточный остаток после производственной себестоимости'));
  const sources=financeEvidence.get(latestCosts.month);
  if(!sources){
   card.append(el(documentRef,'p',
    'Для сопоставления ожидается подтверждение всех трёх финансовых архивов. Не нужно повторно создавать отчёты.'));
   view.prepend(card);return;
  }
  const data=buildYandexPreliminaryContribution(sources,
   latestCosts.costAudit,latestCosts.realizationReports);
  if(data.status==='preliminary_contribution_ready'){
   card.append(el(documentRef,'p','Доход по заказам после уже включённых услуг: '+
    money(data.orderAfterServicesKopecks)));
   card.append(el(documentRef,'p','Себестоимость всех доставленных товаров: '+
    money(data.deliveredManufacturingCostKopecks)));
   card.append(el(documentRef,'h4','Промежуточный остаток: '+
    money(data.preliminaryContributionKopecks)));
   card.append(el(documentRef,'p','Стоимость возвращённых товаров по нормативу: '+
    money(data.returnsIndicativeCostKopecks)+
    ' — не прибавляется автоматически без подтверждения восстановления товара.'));
   card.append(el(documentRef,'p',
    'Ориентир, а не чистая прибыль ИП. Даты операций в отчётах заказов и реализации могут различаться; сверка по orderId, отдельные услуги, налоги и общие расходы ещё необходимы.'));
  }else{
   card.append(el(documentRef,'p',
    'Промежуточный остаток не рассчитан: не все источники или товары полностью подтверждены. Нули вместо неизвестных затрат не используются.'));
   if(data.blockers?.length)card.append(el(documentRef,'p',
    'Не закрыто: '+data.blockers.join(', ')));
  }
  view.prepend(card);
  void persistCloseoutEvidence(data,sources);
 }
 const api=async(path,options)=>{
  const response=await fetcher(path,{
   credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),
   ...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.code||'source_unavailable');
  return data;
 };
 async function persistCloseoutEvidence(data,sources){
  if(!latestCosts||latestCosts.month!==monthNode.value||
     !data||!sources||running&&monthNode.value!==latestCosts.month)return;
  const month=latestCosts.month;
  const jobs=restoreYandexReportJobs(storage);
  const needed=[['all','orders','orders'],['all','services','services'],
   ['all','payments','payments'],
   ['149082506','realization','realization149082506'],
   ['149106500','realization','realization149106500']];
  const reportIds={};
  for(const [scope,type,name] of needed){
   const key=month+':'+scope+':'+type;
   const job=jobs.get(key)||latestReportIds.get(key);
   if(job?.status!=='DONE'||!job.reportId)return;
   reportIds[name]=job.reportId;
  }
  let ledger,finance;
  try{
   ledger=buildYandexSafeSkuEvidence(latestCosts.costAudit,
    latestCosts.realizationReports);
   finance=buildYandexMonthlyEvidence(sources);
  }catch{return;}
  const evidence={ownerEntity:'ИП Жилина Ольга',
   status:data.status==='preliminary_contribution_ready'&&
     ledger.issues.length===0&&ledger.missing.length===0?
      'preliminary_contribution_ready':'partial',
   orderAfterServiceKopecks:data.orderAfterServicesKopecks,
   deliveredCostKopecks:data.deliveredManufacturingCostKopecks,
   returnedValueKopecks:data.returnsIndicativeCostKopecks,
   preliminaryContributionKopecks:
    data.status==='preliminary_contribution_ready'&&
    ledger.issues.length===0&&ledger.missing.length===0?
      data.preliminaryContributionKopecks:null,
   orderRows:finance.orderMargin?.rows??0,
   skus:ledger.rows,issues:ledger.issues,netProfitKopecks:null};
  const body={month,reportIds,evidence};
  const serialized=JSON.stringify(body),now=Date.now();
  if(serialized===lastSnapshotKey&&now-lastSnapshotAttempt<15*60*1000)
   return;
  if(serialized.length>80000)return;
  lastSnapshotKey=serialized;lastSnapshotAttempt=now;
  try{
   const saved=await api('/api/yandex/evidence-snapshot',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:serialized});
   if(saved?.code!=='yandex_month_evidence_saved')
    throw Error('snapshot_not_saved');
   windowRef.dispatchEvent(new CustomEvent('yandex-month-evidence-saved',{
    detail:{month}}));
  }catch(e){
   // Do not claim that the server has evidence when its D1 write failed.
   // Reattempt after the retry window, without requiring owner interaction.
   lastSnapshotKey='';
   const note=el(documentRef,'p',
    'Сверка в браузере доступна, но сохранение в D1 не подтверждено: '+
    safeError(e)+'. Чистая прибыль остаётся неподтверждённой.');
   const previous=view.querySelector?.('#yandexSnapshotSaveStatus');
   previous?.remove();
   note.id='yandexSnapshotSaveStatus';
   view.append(note);
  }
 }
 const safeError=e=>/^[a-z_]{3,80}$/.test(e?.message||'')?
  e.message:'source_unavailable';
 const makeList=(title,rows,format)=>{
  const group=el(documentRef,'details');
  const caption=el(documentRef,'summary',title+' · '+rows.length);
  group.append(caption);
  // Show actionable questions immediately; only confirmed matches collapse.
  group.open=title!=='Подтверждённая себестоимость';
  const list=el(documentRef,'ol');
  for(const x of rows){
   const item=el(documentRef,'li',knownShops[x.partnerId]+
    ' · '+(x.name||x.shopSku)+' · SKU '+x.shopSku+
    (format?format(x):''));
   list.append(item);
  }
  group.append(list);view.append(group);
 };
 async function run(force=false){
  if(running)return;
  const currentPage=windowRef.location.hash.split('/')[0];
  if(currentPage!=='#yandexFinance'&&currentPage!=='#dashboard')return;
  const month=monthNode.value,shop=currentPage==='#dashboard'?
   'all':shopNode.value;
  if(shop!=='all')return;
  const ids=collectYandexConfirmedJobs(storage,month,'all');
  const stored=restoreYandexReportJobs(storage);
  const campaignIds=[149082506,149106500];
  const localReady=!!ids.orders&&campaignIds.every(id=>{
   const job=stored.get(month+':'+id+':realization');
   return job?.status==='DONE'&&job.audited===true;
  });
  if(!localReady){
   // D1 stores opaque IDs and report status only; every server-supplied
   // report must be freshly audited before its figures are used.
   try{
    const records=await api('/api/yandex/report-jobs?month='+
     encodeURIComponent(month));
    if(records.code==='yandex_report_jobs_saved'&&
       records.readOnly===true&&Array.isArray(records.jobs)){
     const remote=records.jobs.filter(j=>j.month===month&&
       j.status==='DONE'&&
       /^[a-zA-Z0-9_-]{1,255}$/.test(j.reportId||'')&&
       ((j.scope==='all'&&
        ['orders','services','payments'].includes(j.reportType))||
        (['149082506','149106500'].includes(j.scope)&&
         j.reportType==='realization')));
     for(const job of remote){
      const key=month+':'+job.scope+':'+job.reportType;
      if(!stored.has(key)){
       // Do not treat a D1 report ID as a completed audit.
       stored.set(key,{status:'DONE',reportId:job.reportId,
        audited:false,noData:false,createdAt:job.createdAt});
      }
     }
    }
   }catch{/* Keep existing browser evidence; no false zero. */}
  }
  const ordersId=ids.orders||
   (stored.get(month+':all:orders')?.status==='DONE'?
    stored.get(month+':all:orders').reportId:null);
  if(!ordersId)return;
  latestReportIds=new Map(stored);
  const realizationJobs=campaignIds.map(id=>stored.get(
   month+':'+id+':realization'));
  const realizationKey=realizationJobs.map(job=>!job?'missing':
   (job.noData?'no-data':
    (job.status==='DONE'&&job.audited?'verified:':'pending:')+
      job.reportId)).join('|');
  const cacheKey=month+':'+ordersId+':'+realizationKey;
  if(!force&&doneKey===cacheKey&&Date.now()-lastRun<15*60*1000)return;
  running=true;status.textContent='Сопоставляем товары Яндекса с подтверждёнными себестоимостями…';
  try{
   const [orders,audit]=await Promise.all([
    api('/api/yandex/report-audit?reportId='+encodeURIComponent(ordersId)),
    api('/api/finance/cost-audit?month='+encodeURIComponent(month))
   ]);
   const realizationProofs={};
   await Promise.all(campaignIds.map(async(id,index)=>{
    const job=realizationJobs[index];
    if(job?.noData){
     realizationProofs[id]={code:'yandex_report_no_data'};
     return;
    }
    if(job?.status!=='DONE')return;
    try{
     const proof=await api('/api/yandex/report-audit?reportId='+
      encodeURIComponent(job.reportId));
     if(proof.code==='yandex_report_archive_audited'&&
        proof.readOnly===true&&proof.changedRecords===0)
      realizationProofs[id]=proof;
    }catch{/* The other shop and the existing orders stay readable. */}
   }));
   const candidates=collectOrderSkuCandidates(orders);
   const seen=new Map(candidates.map(x=>[x.partnerId+':'+x.shopSku,x]));
   for(const item of collectYandexRealizationCandidates(realizationProofs)){
    const k=item.partnerId+':'+item.shopSku;
    const old=seen.get(k);
    if(!old){seen.set(k,item);candidates.push(item);}
    else if(!old.offerName&&item.offerName)old.offerName=item.offerName;
   }
   if(!candidates.length){
    status.textContent='Официальный отчёт не содержит распознанных SKU и названий товаров; автоматическая привязка пока невозможна.';
    return;
   }
   const unique=[...new Set(candidates.map(x=>x.shopSku))];
   let names=new Map(),catalogStatus='not_requested';
   try{
    // One bounded request; fallback to offerName in the official report
    // if catalog-card permission is absent from the Yandex API token.
    if(unique.length<=200){
     const catalog=await api('/api/yandex/catalog-cost-evidence',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({offerIds:unique})});
     if(catalog.code==='yandex_catalog_cost_evidence'){
      names=new Map(catalog.products.map(x=>[x.shopSku,x]));
      catalogStatus='available';
     }
    }else catalogStatus='sku_limit_exceeded';
   }catch(e){catalogStatus=safeError(e);}
   const named=candidates.map(x=>({
    ...x,name:names.get(x.shopSku)?.name||x.offerName,
    catalogPurchasePriceKopecks:names.get(x.shopSku)?.catalogPurchasePriceKopecks??null
   }));
   const result=reconcileYandexSharedCosts(named,audit,month);
   const costOfGoods=reconcileYandexRealizationCosts(result,realizationProofs);
   if(monthNode.value!==month||
      (currentPage==='#yandexFinance'&&shopNode.value!=='all'))return;
   view.replaceChildren();
   const precise=result.rows.filter(x=>['matched_exact','matched_owner']
    .includes(x.status));
   const estimates=result.rows.filter(x=>x.status==='matched_model');
   status.textContent='Товары из отчёта '+month+': '+result.total+
    '; точная себестоимость '+precise.length+
    '; только по модели '+estimates.length+
    '; нет стоимости '+result.missing.length+
    '; расхождения '+result.conflicting.length+
    '. Источник названий: '+(catalogStatus==='available'?
    'каталог Яндекса':'архив заказов')+'.';
   const found=result.rows.filter(x=>['matched_exact','matched_owner']
    .includes(x.status));
   const deliveredStatus=el(documentRef,'div');
   deliveredStatus.className='yandex-realization-cogs';
   deliveredStatus.append(el(documentRef,'h4',
    'Себестоимость по фактически доставленным и возвращённым товарам'));
   for(const shop of costOfGoods.byShop){
    const name=knownShops[shop.campaignId];
    const statusLine=shop.status==='no_data'?
     'Яндекс вернул NO_DATA; нулевые продажи не предполагаются':
     shop.status==='not_ready'?'Отчёт реализации ещё не проверен':
     'доставлено '+(shop.deliveredUnits??'не подтверждено')+
     ', возвращено '+(shop.returnedUnits??'не подтверждено')+
     '; себестоимость доставленных '+money(shop.deliveredCostKopecks)+
     '; стоимость возвращённых по норме '+money(shop.returnedValueKopecks)+
     (shop.missing.length?'; без стоимости SKU: '+shop.missing.length:'');
    deliveredStatus.append(el(documentRef,'p',name+': '+statusLine));
   }
   if(costOfGoods.status==='two_shops_cost_verified')
    deliveredStatus.append(el(documentRef,'p',
     'Всё две точки: себестоимость доставленных '+
     money(costOfGoods.totalDeliveredCostKopecks)+
     '; стоимость возвратов по норме '+
     money(costOfGoods.totalReturnedValueKopecks)+
     '. Это не чистая прибыль и не подтверждённое списание себестоимости возвратов.'));
   else deliveredStatus.append(el(documentRef,'p',
    'Себестоимость ИП Жилиной ещё не подтверждена: '+
    'нет всех отчётов или цен. Пустые источники не считаются нулём.'));
   view.append(deliveredStatus);
   makeList('Подтверждённая себестоимость',found,x=>
    ' · '+money(x.costKopecks)+' · '+x.sources.join(' + '));
   makeList('По модели — требуется идентификация комплектации',
    estimates,x=>' · ориентир '+money(x.costKopecks)+
     ' · '+x.sources.join(' + '));
   const unresolved=new Map(result.missing.map(x=>
    [x.partnerId+':'+x.shopSku,x]));
   for(const x of costOfGoods.missing){
    const k=x.partnerId+':'+x.shopSku;
    if(!unresolved.has(k))unresolved.set(k,{
     ...x,missingSource:'realization'});
   }
   makeList('Нужна себестоимость', [...unresolved.values()]);
   makeList('Разные цены в справочниках · требует уточнения',
    result.conflicting,x=>' · варианты: '+
     (x.pricesKopecks||[]).map(money).join(' / '));
   view.append(el(documentRef,'p','Подтверждённая себестоимость за штуку не равна чистой прибыли. Количество проданных и возвращённых товаров, налоги и внешние расходы сверяются отдельно.'));
   latestCosts={month,costAudit:result,realizationReports:realizationProofs};
   showContribution();
   doneKey=cacheKey;lastRun=Date.now();
  }catch(e){
   status.textContent='Сопоставление себестоимости недоступно: '+
    safeError(e)+'. Неизвестные значения не заменяются нулём.';
  }finally{running=false;}
 }
 windowRef.addEventListener('yandex-financial-sources-audited',event=>{
  const detail=event?.detail;
  if(!detail||!/^(20\\d{2})-(0[1-9]|1[0-2])$/.test(detail.month)||
     !detail.sources)return;
  financeEvidence.set(detail.month,detail.sources);
  showContribution();
 });
 windowRef.addEventListener('yandex-finance-ready',()=>{void run(true);});
 windowRef.addEventListener('yandex-auto-jobs-updated',()=>{void run();});
 windowRef.addEventListener('hashchange',()=>{void run();});
 monthNode.addEventListener('change',()=>{doneKey='';void run();});
 shopNode.addEventListener('change',()=>{doneKey='';void run();});
 void run();
 return true;
}
if(typeof document!=='undefined')attachYandexCostCrosswalk();
