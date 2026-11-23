import {validateDashboardWbMonth} from './wb-month-settlement-ui.mjs';
import {financeRateBps,displayRate,formatFinanceRub,
 previousMonth,comparativeFinance} from './channel-finance-metrics.mjs';
function row(doc,label,value,kind='normal'){
 const e=doc.createElement('article');e.className='profit-card profit-card-'+kind;
 const h=doc.createElement('h3');h.textContent=label;
 const b=doc.createElement('strong');b.textContent=value;
 e.append(h,b);return e;
}
export function wbMonthManagementMetrics(source,month){
 const x=validateDashboardWbMonth(source,month);
 const basis=source.productPayoutKopecks-source.returnsKopecks;
 if(!Number.isSafeInteger(basis)||basis<=0)throw Error('invalid_wb_basis');
 return {...x,month,basisKopecks:basis,
  afterChargesRateBps:financeRateBps(x.amountKopecks,basis),
  costComplete:false,profitKopecks:null};
}
export function attachWbFinancialPnl({documentRef=document,fetcher=fetch}={}){
 const root=documentRef.getElementById('wbManagementProfit');
 const monthInput=documentRef.getElementById('wbProfitMonth');
 const button=documentRef.getElementById('wbProfitReload');
 const status=documentRef.getElementById('wbProfitStatus');
 const cards=documentRef.getElementById('wbProfitCards');
 const before=documentRef.getElementById('wbProfitComparison');
 if(!root||!monthInput||!button||!status||!cards||!before)return false;
 let serial=0;
 async function fetchMonth(month){
  const res=await fetcher('/api/wb/month-settlement?month='+encodeURIComponent(month),{
   method:'GET',credentials:'same-origin',cache:'no-store',
   signal:AbortSignal.timeout(16000)});
  if(!res.ok)throw Error('wb_period_not_reconciled');
  return wbMonthManagementMetrics(await res.json(),month);
 }
 async function load(){
  const id=++serial,month=monthInput.value;
  status.textContent='Пересчитываем финансовые операции WB…';
  button.disabled=true;cards.replaceChildren();
  before.textContent='Сравнение периодов проверяется отдельно.';
  try{
   const result=await fetchMonth(month);
   if(id!==serial||monthInput.value!==month)return;
   const money=formatFinanceRub;
   const fields=[
    ['Продажи · сумма расчётов WB',result.breakdown[0][1]],
    ['Возвраты WB',result.breakdown[1][1]],
    ['После возвратов, до удержаний',result.basisKopecks],
    ['Доставка',result.breakdown[2][1]],
    ['Хранение',result.breakdown[3][1]],
    ['Удержания',result.breakdown[4][1]],
    ['Штрафы',result.breakdown[5][1]],
    ['Всего удержаний WB',-result.breakdown.slice(2).reduce((n,x)=>n-x[1],0)],
    ['После удержаний WB · до себестоимости',result.amountKopecks]
   ];
   for(const [label,amount] of fields){
    cards.append(row(documentRef,label,money(amount),
      label.includes('После удержаний WB ·')?'interim':'normal'));
   }
   cards.append(row(documentRef,'Доля после удержаний к сумме после возвратов',
     displayRate(result.afterChargesRateBps),'separate'));
   cards.append(row(documentRef,'Себестоимость товаров WB','Не подтверждена','pending'));
   cards.append(row(documentRef,'Валовая прибыль WB','Пока не рассчитана','pending'));
   cards.append(row(documentRef,'Операционная прибыль WB','Пока не рассчитана','pending'));
   cards.append(row(documentRef,'Чистая прибыль всего бизнеса','Ожидает закрытия','pending'));
   status.textContent='Сверены '+result.reports+' отчётов, '+result.rows+
    ' операций. Себестоимость подтверждена: '+result.confirmedCostArticles+
    ' из '+result.soldArticles+' артикулов; предварительная: '+
    result.preliminaryCostArticles+
    '. Показатель после удержаний НЕ является прибылью. Внешняя реклама, общие расходы и налог отдельно.';
   button.disabled=false;button.textContent='Обновить отчёт WB';
   try{
    const prev=previousMonth(month);
    const old=await fetchMonth(prev);
    if(id!==serial||monthInput.value!==month)return;
    const change=comparativeFinance(result.amountKopecks,old.amountKopecks);
    before.textContent='Сравнение с '+prev+' по показателю до себестоимости: '+
      money(old.amountKopecks)+' → '+money(result.amountKopecks)+
      '; изменение '+money(change.absoluteKopecks)+
      (change.changeBps===null?'':' ('+displayRate(change.changeBps)+')')+
      '. Это сравнение расчётов WB, НЕ прибыли.';
   }catch{
    if(id===serial&&monthInput.value===month)
     before.textContent='Предыдущий месяц: сопоставимых полностью сверенных отчётов нет. Сравнение не рассчитывается.';
   }
  }catch{
   if(id!==serial||monthInput.value!==month)return;
   button.disabled=false;button.textContent='Обновить отчёт WB';
   status.textContent='Финансовые отчёты за выбранный месяц недоступны либо не сверены. Суммы не подставлены из другого периода.';
   before.textContent='Для сравнения нужны два завершённых сопоставимых месяца.';
  }
 }
 button.addEventListener('click',load);
 monthInput.addEventListener('change',load);
 const show=()=>{if(location.hash.split('/')[0]==='#wbFinance')load();};
 window.addEventListener('hashchange',show);
 if(location.hash.split('/')[0]==='#wbFinance')load();
 return true;
}
if(typeof document!=='undefined')attachWbFinancialPnl();
