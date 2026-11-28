import {sadUnitEvidence} from './shop-unit-evidence.mjs';
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
   for(const v of [x.sku,x.name,x.sold,x.returned,rub(x.cost),rub(x.total),'Н/Д',x.review]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}
   const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.className='button light';b.textContent='В сценарий';b.disabled=x.cost===null;
   b.addEventListener('click',()=>{form.reset();for(const k of ['price','cost','platform','logistics','returnsReserve','tax','overhead','targetProfit','advertising'])form.elements.namedItem(k).value=k==='cost'?(x.cost/100).toFixed(2):'';form.elements.namedItem('costBasis').value='';form.elements.namedItem('expensesSeparated').checked=false;form.dispatchEvent(new Event('input',{bubbles:true}));by('unitPlannerScenarioSource').textContent='Сад · '+x.sku+' · '+m+'. Историческая себестоимость. Подтвердите её вид и актуальность, заполните цену и расходы. Бюджет не утверждён.';by('unitPlannerTitle').scrollIntoView({block:'start'});});
   td.append(b);tr.append(td);body.append(tr);
  }
 }
 button.addEventListener('click',async()=>{clear();const m=month.value,g=generation;if(!monthValid(m)||m>last)return;button.disabled=true;status.textContent='Загрузка…';
  try{const r=await fetch('/api/yandex/evidence-snapshot?month='+encodeURIComponent(m),{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});const d=r.ok?await r.json():null;if(g!==generation)return;const rows=sadUnitEvidence(m,d);if(!rows){status.textContent='Нет полной сохранённой сверки SKU магазина Сад за месяц. Доход и прибыль не подтверждены.';return;}render(rows,m);status.textContent='Артикулов: '+rows.length+'. Только Сад. Доход после услуг по SKU не подтверждён; прибыль и рекламный бюджет не рассчитываются.';}catch{if(g===generation)status.textContent='Источник Яндекс недоступен.';}finally{if(g===generation)button.disabled=false;}
 });
}
