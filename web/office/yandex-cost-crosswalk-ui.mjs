import {collectYandexConfirmedJobs}
 from './yandex-finance-audit-ui.mjs';
import {reconcileYandexSharedCosts}
 from './yandex-cost-crosswalk-core.mjs';
import {restoreYandexReportJobs} from './yandex-finance-job-cache.mjs';
import {reconcileYandexRealizationCosts,collectYandexRealizationCandidates}
 from './yandex-realization-cost-evidence.mjs';
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
 section.append(head,status,view);root.append(section);
 let running=false,doneKey='',lastRun=0;
 const api=async(path,options)=>{
  const response=await fetcher(path,{
   credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),
   ...options});
  const data=await response.json();
  if(!response.ok)throw Error(data.code||'source_unavailable');
  return data;
 };
 const safeError=e=>/^[a-z_]{3,80}$/.test(e?.message||'')?
  e.message:'source_unavailable';
 const makeList=(title,rows,format)=>{
  const group=el(documentRef,'details');
  const caption=el(documentRef,'summary',title+' · '+rows.length);
  group.append(caption);
  // Show actionable questions immediately; only confirmed matches collapse.
  group.open=title!=='Стоимость найдена';
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
  if(windowRef.location.hash.split('/')[0]!=='#yandexFinance')return;
  const month=monthNode.value,shop=shopNode.value;
  if(shop!=='all')return;
  const ids=collectYandexConfirmedJobs(storage,month,'all');
  if(!ids.orders)return;
  const stored=restoreYandexReportJobs(storage);
  const campaignIds=[149082506,149106500];
  const realizationJobs=campaignIds.map(id=>stored.get(
   month+':'+id+':realization'));
  const realizationKey=realizationJobs.map(job=>!job?'missing':
   (job.noData?'no-data':
    (job.status==='DONE'&&job.audited?'verified:':'pending:')+
      job.reportId)).join('|');
  const cacheKey=month+':'+ids.orders+':'+realizationKey;
  if(!force&&doneKey===cacheKey&&Date.now()-lastRun<15*60*1000)return;
  running=true;status.textContent='Сопоставляем товары Яндекса с подтверждёнными себестоимостями…';
  try{
   const [orders,audit]=await Promise.all([
    api('/api/yandex/report-audit?reportId='+encodeURIComponent(ids.orders)),
    api('/api/finance/cost-audit?month='+encodeURIComponent(month))
   ]);
   const realizationProofs={};
   await Promise.all(campaignIds.map(async(id,index)=>{
    const job=realizationJobs[index];
    if(job?.noData){
     realizationProofs[id]={code:'yandex_report_no_data'};
     return;
    }
    if(job?.status!=='DONE'||!job.audited)return;
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
   if(monthNode.value!==month||shopNode.value!=='all')return;
   view.replaceChildren();
   status.textContent='Товары из отчёта '+month+': '+result.total+
    '; себестоимость определена '+result.matched+
    '; нет стоимости '+result.missing.length+
    '; расхождения '+result.conflicting.length+
    '. Источник названий: '+(catalogStatus==='available'?
    'каталог Яндекса':'архив заказов')+'.';
   const found=result.rows.filter(x=>x.costKopecks!==null);
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
    'Общая себестоимость ООО ещё не подтверждена: '+
    'нет всех отчётов или цен. Пустые источники не считаются нулём.'));
   view.append(deliveredStatus);
   makeList('Стоимость найдена',found,x=>
    ' · '+money(x.costKopecks)+' · '+x.sources.join(' + '));
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
   doneKey=cacheKey;lastRun=Date.now();
  }catch(e){
   status.textContent='Сопоставление себестоимости недоступно: '+
    safeError(e)+'. Неизвестные значения не заменяются нулём.';
  }finally{running=false;}
 }
 windowRef.addEventListener('yandex-finance-ready',()=>{void run(true);});
 windowRef.addEventListener('yandex-auto-jobs-updated',()=>{void run();});
 windowRef.addEventListener('hashchange',()=>{void run();});
 monthNode.addEventListener('change',()=>{doneKey='';void run();});
 shopNode.addEventListener('change',()=>{doneKey='';void run();});
 void run();
 return true;
}
if(typeof document!=='undefined')attachYandexCostCrosswalk();
