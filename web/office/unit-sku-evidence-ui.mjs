import {ozonUnitEvidence,unitReview,skuScenarioInputs} from './unit-sku-evidence.mjs';
const by=id=>document.getElementById(id),month=by('unitSkuMonth'),button=by('unitSkuLoad'),status=by('unitSkuStatus'),body=by('unitSkuRows'),form=by('unitPlannerForm'),filter=by('unitSkuFilter');
const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Н/Д';
if(month&&button&&status&&body&&form&&filter){
 let generation=0,items=[];
 const now=new Date(),last=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);month.value=last;month.max=last;
 function clear(){generation++;items=[];body.replaceChildren();button.disabled=false;status.textContent='Выберите закрытый месяц и загрузите данные Ozon.';}
 function render(){body.replaceChildren();for(const x of items){
 if(filter.value==='cost'&&x.historicalCostKopecks!==null||filter.value==='returns'&&unitReview(x)!=='Проверить возвраты')continue;
 const tr=document.createElement('tr');
 for(const v of [x.sku,x.name,x.sold,x.returned??'Н/Д',money(x.averageRevenueKopecks),money(x.historicalCostKopecks),money(x.attributedCharges.commission),money(x.attributedCharges.delivery),money(x.attributedCharges.ads),unitReview(x)]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}
 const td=document.createElement('td'),b=document.createElement('button');b.type='button';b.className='button light';b.textContent='В сценарий';b.addEventListener('click',()=>{const v=skuScenarioInputs(x);if(!v)return;form.reset();for(const k of ['price','cost','platform','logistics','returnsReserve','tax','overhead','targetProfit','advertising'])form.elements.namedItem(k).value=v[k]||'';form.elements.namedItem('costBasis').value='';form.elements.namedItem('expensesSeparated').checked=false;form.dispatchEvent(new Event('input',{bubbles:true}));by('unitPlannerTitle').scrollIntoView({block:'start'});by('unitPlannerScenarioSource').textContent='Исторический сценарий Ozon SKU '+x.sku+' за '+month.value+'. Выручка на единицу не обязательно равна текущей цене. Подтвердите вид себестоимости и введите остальные расходы.';});td.append(b);tr.append(td);body.append(tr);
 }}
 month.addEventListener('change',clear);filter.addEventListener('change',render);window.addEventListener('hashchange',clear);
 button.addEventListener('click',async()=>{clear();const g=generation,m=month.value;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m)||m>last)return;button.disabled=true;status.textContent='Загрузка…';try{const r=await fetch('/api/ozon/profit?month='+encodeURIComponent(m),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});const data=r.ok?await r.json():null;if(g!==generation)return;items=ozonUnitEvidence(m,data);render();status.textContent=items.length?'Артикулов: '+items.length+'. Удержания — только строки с указанным SKU за весь месяц, не полные расходы.':'Нет подтверждённых данных SKU за выбранный месяц.';}catch{if(g===generation)status.textContent='Источник недоступен.';}finally{if(g===generation)button.disabled=false;}});
}
