import {monthValid,previousClosedMonth,adaptOzon,adaptWb,adaptYandex,compareAmounts,attachWbSku,rankSalesRows,volumeAbc,ozonDailyUnits,attachSadSku,returnRatio,salesSignal} from './sales-analytics-core.mjs';
const by=id=>document.getElementById(id);
const month=by('salesAnalyticsMonth'),button=by('salesAnalyticsLoad'),body=by('salesAnalyticsRows'),skuBody=by('salesAnalyticsSkuRows'),status=by('salesAnalyticsStatus');
const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Н/Д';
const number=n=>Number.isSafeInteger(n)?String(n):'Н/Д';
const sources=[['/api/ozon/profit',adaptOzon],['/api/wb/month-settlement',adaptWb],['/api/yandex/evidence-snapshot',adaptYandex]];
async function load(path,adapt,m){try{const r=await fetch(path+'?month='+encodeURIComponent(m),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});const data=r.ok?await r.json():null;const result=adapt(m,data);return adapt===adaptOzon?{...result,daily:ozonDailyUnits(m,data)}:result;}catch{return adapt(m,null);}}
function row(target,values){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}target.append(tr);}
if(month&&button&&body&&skuBody&&status){
 let generation=0;
 const currentMonth=()=>new Date().toISOString().slice(0,7);
 month.value=previousClosedMonth(currentMonth());month.max=month.value;
 const daily=by('salesAnalyticsDailyRows');const clear=()=>{generation++;daily?.replaceChildren();body.replaceChildren();skuBody.replaceChildren();button.disabled=false;status.textContent='Выберите закрытый месяц и нажмите «Загрузить аналитику».';};
 month.addEventListener('change',clear);window.addEventListener('hashchange',clear);
 button.addEventListener('click',async()=>{
  clear();const m=month.value,g=generation;if(!monthValid(m)||m>=currentMonth()){status.textContent='Выберите закрытый месяц.';return;}
  button.disabled=true;status.textContent='Загрузка сохранённых отчётов…';
  try{const prev=previousClosedMonth(m);
   for(const [path,adapt] of sources){
    let [a,b]=await Promise.all([load(path,adapt,m),load(path,adapt,prev)]);if(g!==generation)return;
    if(adapt===adaptWb){a=await load('/api/wb/sales-sku',(m,d)=>attachWbSku(m,a,d),m);if(g!==generation)return;}
    if(adapt===adaptYandex&&a.sold===null){a=await load('/api/yandex/sales-sku',(m,d)=>attachSadSku(m,a,d),m);if(g!==generation)return;}
    const c=compareAmounts(a,b);
    row(body,[a.channel,a.meaning,money(a.amount),money(b.amount),c?money(c.delta):'Н/Д',c?.bps!=null?(c.bps/100).toFixed(1)+'%':'Н/Д',number(a.sold),number(a.returned),returnRatio(a.sold,a.returned)===null?'Н/Д':(100*returnRatio(a.sold,a.returned)).toFixed(1)+'%']);
    const abc=new Map(volumeAbc(a.rows).map(s=>[s.sku,s]));
    for(const s of rankSalesRows(a.rows)){const v=abc.get(s.sku);row(skuBody,[a.channel,s.sku,s.name,number(s.sold),number(s.returned),v?.group||'Н/Д',v?(v.share*100).toFixed(1)+'%':'Н/Д',returnRatio(s.sold,s.returned)===null?'Н/Д':(100*returnRatio(s.sold,s.returned)).toFixed(1)+'%',salesSignal({...s,group:v?.group})]);}
    if(daily&&adapt===adaptOzon){if(a.daily)for(const day of a.daily)row(daily,[day.date,day.sold,day.returned]);else row(daily,['Нет подтверждённой динамики','Н/Д','Н/Д']);}
   }
   status.textContent='Показаны доступные данные за '+m+' и '+prev+'. Н/Д — нет подтверждённого значения. Суммы разных каналов не складываются. Н/Д за предыдущий месяц — нет подтверждённого сопоставимого отчёта. Возвраты относятся к периоду, не к когорте продаж.';
  }finally{if(g===generation)button.disabled=false;}
 });
}
