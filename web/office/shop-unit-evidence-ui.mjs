import {sadUnitEvidence,sadQuantityEvidence,attachSadWbCostReview,sadOrderReview} from './shop-unit-evidence.mjs';
import {monthValid,previousClosedMonth} from './sales-analytics-core.mjs';
const by=id=>document.getElementById(id);
const month=by('unitSadMonth'),button=by('unitSadLoad'),body=by('unitSadRows'),status=by('unitSadStatus'),form=by('unitPlannerForm');
const rub=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Н/Д';
if(month&&button&&body&&status&&form){
 let generation=0;
 const last=previousClosedMonth(new Date().toISOString().slice(0,7));month.value=last;month.max=last;
 function clear(){generation++;body.replaceChildren();button.disabled=false;status.textContent='Выберите закрытый месяц магазина Сад.';}
 month.addEventListener('change',clear);window.addEventListener('hashchange',clear);
 function render(rows,m){
  for(const x of rows){
   const tr=document.createElement('tr');
   for(const v of [x.sku,x.name,x.sold,x.returned,x.cost!==null?rub(x.cost):x.candidateCost!=null?rub(x.candidateCost)+' (норма WB, сверить)':'Н/Д',x.total!==null?rub(x.total):x.candidateTotal!=null?rub(x.candidateTotal)+' (ориентир)':'Н/Д','Н/Д',x.review]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}
   const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.className='button light';b.textContent='В сценарий';b.disabled=x.cost===null;
   b.addEventListener('click',()=>{form.reset();for(const k of ['price','cost','platform','logistics','returnsReserve','tax','overhead','targetProfit','advertising'])form.elements.namedItem(k).value=k==='cost'?(x.cost/100).toFixed(2):'';form.elements.namedItem('costBasis').value='';form.elements.namedItem('expensesSeparated').checked=false;form.dispatchEvent(new Event('input',{bubbles:true}));by('unitPlannerScenarioSource').textContent='Сад · '+x.sku+' · '+m+'. Историческая себестоимость. Подтвердите её вид и актуальность, заполните цену и расходы. Бюджет не утверждён.';by('unitPlannerTitle').scrollIntoView({block:'start'});});
   td.append(b);tr.append(td);body.append(tr);
  }
 }
 button.addEventListener('click',async()=>{clear();const m=month.value,g=generation;if(!monthValid(m)||m>last)return;button.disabled=true;status.textContent='Загрузка…';
  try{const r=await fetch('/api/yandex/evidence-snapshot?month='+encodeURIComponent(m),{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});const d=r.ok?await r.json().catch(()=>null):null;if(g!==generation)return;let rows=sadUnitEvidence(m,d),quantityOnly=false;if(!rows){const q=await fetch('/api/yandex/sales-sku?month='+encodeURIComponent(m),{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});const payload=await q.json().catch(()=>null);if(g!==generation)return;rows=q.ok?sadQuantityEvidence(m,payload):null;quantityOnly=true;if(!rows){const allowed=['sad_report_not_ready','archive_unavailable','quantity_coverage_incomplete','source_unavailable'];const reason=allowed.includes(payload?.reason)?payload.reason:'response_unverified';status.textContent='Сверка Сад недоступна. Код: '+reason+'; HTTP '+q.status;return;}}if(rows.some(x=>x.cost===null)){try{const a=await fetch('/api/finance/cost-audit?month='+encodeURIComponent(m),{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});if(a.ok)rows=attachSadWbCostReview(m,rows,await a.json());}catch{/* SKU quantities remain available. */}if(g!==generation)return;}render(rows,m);const candidates=rows.filter(x=>x.candidateCost!=null).length;status.textContent='Артикулов: '+rows.length+'. Только Сад. '+(quantityOnly?'Количество из отчёта реализации; себестоимость не подтверждена. ':'')+(candidates?'Точные артикулы с нормой WB за месяц: '+candidates+' (кандидаты, не подтверждённый перенос). ':'')+'Доход после услуг по SKU не подтверждён; прибыль и рекламный бюджет не рассчитываются.';}catch{if(g===generation)status.textContent='Источник Яндекс недоступен.';}finally{if(g===generation)button.disabled=false;}
 });
}

const financeButton=by('unitSadFinanceReview'),financeStatus=by('unitSadFinanceStatus');
if(month&&financeButton&&financeStatus){
 let revision=0;
 const clear=()=>{revision++;financeButton.disabled=false;financeStatus.textContent='Доход по товарам требует отдельной сверки состава заказов.';};
 month.addEventListener('change',clear);window.addEventListener('hashchange',clear);
 const get=async path=>{const r=await fetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});return r.ok?await r.json():null;};
 financeButton.addEventListener('click',async()=>{
  clear();const g=revision,m=month.value;if(!monthValid(m)||m>=new Date().toISOString().slice(0,7))return;
  financeButton.disabled=true;financeStatus.textContent='Сверяем отчёты по заказам и доставкам Сада…';
  try{
   const jobs=await get('/api/yandex/report-jobs?month='+encodeURIComponent(m));if(g!==revision)return;
   const select=(scope,type)=>jobs?.code==='yandex_report_jobs_saved'&&jobs.readOnly===true&&Array.isArray(jobs.jobs)?jobs.jobs.filter(x=>x.month===m&&x.scope===scope&&x.reportType===type&&x.status==='DONE'&&/^[a-zA-Z0-9_-]{1,255}$/.test(x.reportId||'')):[];
   const a=select('all','orders'),b=select('149082506','realization');
   if(a.length!==1||b.length!==1){financeStatus.textContent='Нет двух подтверждённых отчётов для сверки.';return;}
   const [orders,realization]=await Promise.all([a,b].map(x=>get('/api/yandex/report-audit?reportId='+encodeURIComponent(x[0].reportId))));
   if(g!==revision)return;const result=sadOrderReview(m,jobs,orders,realization);
   financeStatus.textContent=result?'Заказов в доставках Сада: '+result.orders+'; найдено в отчёте доходов: '+result.matched+'; без совпадения: '+result.unmatched+'; с несколькими доставленными SKU: '+result.multiSku+'. Доход на SKU не подтверждён: нужен полный состав заказа.':'Состав или суммы отчётов не прошли проверку. Доход по SKU не подтверждён.';
  }catch{if(g===revision)financeStatus.textContent='Источник сверки недоступен.';}finally{if(g===revision)financeButton.disabled=false;}
 });
}
