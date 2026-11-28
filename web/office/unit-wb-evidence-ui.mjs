import {wbUnitEvidence,wbEvidenceDiagnostic} from './unit-wb-evidence.mjs';
import {wbContributionRanking} from './shop-unit-evidence.mjs';
const by=id=>document.getElementById(id);
const button=by('unitWbLoad'),body=by('unitWbRows'),status=by('unitWbStatus'),sort=by('unitWbSort'),period=by('unitWbPeriod');
const rub=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):'Н/Д';
if(button&&body&&status&&sort&&period){
 // Offer current and prior months; the server includes whole reports only.
 const date=new Date(),current=date.toISOString().slice(0,7);period.replaceChildren();
 const all=document.createElement('option');all.value='';all.textContent='Все завершённые отчёты';period.append(all);
 for(let i=0;i<12;i++){const m=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-i,1));const o=document.createElement('option');o.value=m.toISOString().slice(0,7);o.textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(m);period.append(o);}
 period.value=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-1,1)).toISOString().slice(0,7);
 let scopeNote='';
 let generation=0,items=[];
 function clear(){generation++;items=[];scopeNote='';body.replaceChildren();button.disabled=false;status.textContent='Загрузите сверенные отчёты WB.';}
 function render(){
  body.replaceChildren();
  const ranking=sort.value==='sales'?items:wbContributionRanking(items);
  const rows=sort.value==='negative'?ranking.filter(x=>x.contribution<0):ranking;
  for(const x of rows){const tr=document.createElement('tr');for(const v of [x.sku,x.sold,x.returned,rub(x.payout),rub(x.fees),rub(x.cost),rub(x.contribution),x.signal||x.review]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}body.append(tr);}
  status.textContent='Артикулов: '+rows.length+' из '+items.length+'. '+scopeNote+' Вклад не равен чистой прибыли; рекламный бюджет не утверждён.'+(sort.value==='sales'?'':' Неизвестный вклад не включён в рейтинг.')+(!rows.length&&items.length?' Нет товаров с подтверждённым вкладом для выбранного фильтра.':'');
 }
 sort.addEventListener('change',()=>{if(items.length)render();});
 period.addEventListener('change',clear);
 window.addEventListener('hashchange',clear);
 button.addEventListener('click',async()=>{
  clear();const g=generation,m=period.value;button.disabled=true;status.textContent='Загрузка…';
  try{
   const r=await fetch('/api/wb/unit-economics'+(m?'?reportMonth='+encodeURIComponent(m):''),{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
   let d=null;try{d=await r.json();}catch{if(g===generation)status.textContent='Ответ WB не в формате JSON. Код: wb_response_not_json; HTTP '+r.status;return;}if(g!==generation)return;
   const diagnostic=wbEvidenceDiagnostic(r.status,d);
   if(diagnostic!=='ok'){status.textContent='Финансовые данные WB не подтверждены. Код: '+diagnostic+'; HTTP '+r.status;return;}
   if((d.reportMonth??null)!==(m||null)||d.reportSelection!==(m?'WHOLE_REPORTS_WITHIN_MONTH':'ALL_COMPLETED_REPORTS')||d.calendarCoverageVerified!==false){status.textContent='Период ответа WB не подтверждён.';return;}
   scopeNote=(m?'Целые завершённые отчёты внутри '+m+'. ':'Все завершённые отчёты. ')+'Полнота календарного месяца не подтверждена.';
   if(Number.isSafeInteger(d.confirmedCostSoldUnits)&&Number.isSafeInteger(d.unverifiedCostSoldUnits))scopeNote+=' Себестоимость: подтверждено '+d.confirmedCostSoldUnits+' шт., не подтверждено '+d.unverifiedCostSoldUnits+' шт.';
   const rows=wbUnitEvidence(d);
   if(!rows){status.textContent='Нет подтверждённых данных WB.';return;}
   items=rows;render();
  }catch{if(g===generation)status.textContent='Источник WB недоступен.';}
  finally{if(g===generation)button.disabled=false;}
 });
}
