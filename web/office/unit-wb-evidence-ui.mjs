import {wbUnitEvidence} from './unit-wb-evidence.mjs';
const by=id=>document.getElementById(id);
const button=by('unitWbLoad'),body=by('unitWbRows'),status=by('unitWbStatus');
const rub=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Н/Д';
if(button&&body&&status){
 let generation=0;
 function clear(){generation++;body.replaceChildren();button.disabled=false;status.textContent='Загрузите сверенные отчёты WB.';}
 window.addEventListener('hashchange',clear);
 button.addEventListener('click',async()=>{
  clear();const g=generation;button.disabled=true;status.textContent='Загрузка…';
  try{
   const r=await fetch('/api/wb/unit-economics',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});
   const d=r.ok?await r.json():null;if(g!==generation)return;
   const rows=wbUnitEvidence(d);
   if(!rows){status.textContent='Нет подтверждённых данных WB.';return;}
   for(const x of rows){const tr=document.createElement('tr');for(const v of [x.sku,x.sold,x.returned,rub(x.payout),rub(x.fees),rub(x.cost),rub(x.contribution),x.review]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}body.append(tr);}
   status.textContent='Артикулов: '+rows.length+'. Только завершённые сверенные отчёты, не календарный месяц. Вклад не равен чистой прибыли; рекламный бюджет не утверждён.';
  }catch{if(g===generation)status.textContent='Источник WB недоступен.';}
  finally{if(g===generation)button.disabled=false;}
 });
}
