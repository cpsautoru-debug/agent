import {planUnit,parseRubles} from './unit-planner-core.mjs';
const form=document.getElementById('unitPlannerForm'),result=document.getElementById('unitPlannerResult');
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
if(form&&result){
 const get=k=>form.elements.namedItem(k);
 const clear=()=>{result.replaceChildren();result.textContent='Введите все расходы, включая явные нули, и рассчитайте сценарий.';};
 form.addEventListener('input',()=>{get('overhead').disabled=get('costBasis').value==='full';clear();});
 form.addEventListener('submit',event=>{
  event.preventDefault();clear();
  const fields=['price','cost','platform','logistics','returnsReserve','tax','overhead','targetProfit','advertising'];
  const x=Object.fromEntries(fields.map(k=>[k,parseRubles(get(k).value)]));
  x.costBasis=get('costBasis').value;x.expensesSeparated=get('expensesSeparated').checked;
  if(x.costBasis==='full')x.overhead=0;
  const p=planUnit(x);
  if(!p){result.textContent='Проверьте поля и подтвердите отсутствие двойного учёта. Все расходы должны быть указаны.';return;}
  const rows=[['Прибыль до рекламы',money(p.beforeAds)],['Прибыль после рекламы',money(p.profit)],['Реклама до безубыточности',p.breakEvenFeasible?money(p.breakEvenAds):'Убыток даже без рекламы'],['Реклама при целевой прибыли',p.targetFeasible?money(p.maxAds):'Цель недостижима'],['Предельный ДРР для цели',p.targetFeasible?p.maxDrr.toFixed(2)+'%':'Н/Д'],['Минимальный ROAS для цели',p.minimumRoas===null?'Н/Д':p.minimumRoas.toFixed(2)],['Фактический ДРР сценария',p.actualDrr.toFixed(2)+'%'],['Цель',p.targetMet?'Достигается':'Не достигается']];
  result.replaceChildren();for(const [label,value] of rows){const line=document.createElement('p'),b=document.createElement('strong');line.append(document.createTextNode(label+': '));b.textContent=value;line.append(b);result.append(line);}
 });
 window.addEventListener('hashchange',clear);
}
