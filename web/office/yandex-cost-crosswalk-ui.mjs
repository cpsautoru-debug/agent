import {collectYandexConfirmedJobs}
 from './yandex-finance-audit-ui.mjs';
import {reconcileYandexSharedCosts}
 from './yandex-cost-crosswalk-core.mjs';
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
  const cacheKey=month+':'+ids.orders;
  if(!force&&doneKey===cacheKey&&Date.now()-lastRun<15*60*1000)return;
  running=true;status.textContent='Сопоставляем товары Яндекса с подтверждёнными себестоимостями…';
  try{
   const [orders,audit]=await Promise.all([
    api('/api/yandex/report-audit?reportId='+encodeURIComponent(ids.orders)),
    api('/api/finance/cost-audit?month='+encodeURIComponent(month))
   ]);
   const candidates=collectOrderSkuCandidates(orders);
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
   if(monthNode.value!==month||shopNode.value!=='all')return;
   view.replaceChildren();
   status.textContent='Товары из отчёта '+month+': '+result.total+
    '; себестоимость определена '+result.matched+
    '; нет стоимости '+result.missing.length+
    '; расхождения '+result.conflicting.length+
    '. Источник названий: '+(catalogStatus==='available'?
    'каталог Яндекса':'архив заказов')+'.';
   const found=result.rows.filter(x=>x.costKopecks!==null);
   makeList('Стоимость найдена',found,x=>
    ' · '+money(x.costKopecks)+' · '+x.sources.join(' + '));
   makeList('Нужна себестоимость',result.missing);
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
 windowRef.addEventListener('hashchange',()=>{void run();});
 monthNode.addEventListener('change',()=>{doneKey='';void run();});
 shopNode.addEventListener('change',()=>{doneKey='';void run();});
 void run();
 return true;
}
if(typeof document!=='undefined')attachYandexCostCrosswalk();
