import {OWNER_UNIT_COSTS,OWNER_COST_SOURCE} from './owner-unit-costs.mjs';
// Shared reference shown in every finance section. Not a claim that SKU
// allocations or accounting closeout are verified.
const targets=[['ozonFinance','Ozon'],['ozonProfit','Ozon · прибыль'],
 ['wbFinance','Wildberries'],['yandexFinance','Яндекс Маркет']];
const rub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
export function attachOwnerUnitCostReference(doc=document){
 for(const [key,channel] of targets){
  const section=doc.querySelector('[data-section="'+key+'"]');
  if(!section||section.querySelector('[data-owner-cost-reference]'))continue;
  const card=doc.createElement('details');
  card.dataset.ownerCostReference='';
  card.className='profit-panel';
  const summary=doc.createElement('summary');
  summary.textContent='Единый справочник себестоимости · '+channel;
  card.append(summary);
  const message=doc.createElement('p');
  message.textContent='Подтверждённые владельцем нормативы на единицу для Ozon, WB и Яндекса. Цена конкретного SKU, её исторический период и возвраты требуют отдельной сверки; справочник сам по себе не закрывает чистую прибыль.';
  card.append(message);
  const table=doc.createElement('table');
  const head=doc.createElement('thead');
  const tr=doc.createElement('tr');
  for(const name of ['Изделие','Себестоимость']){
   const th=doc.createElement('th');th.textContent=name;tr.append(th);
  }
  head.append(tr);table.append(head);
  const body=doc.createElement('tbody');
  for(const x of Object.values(OWNER_UNIT_COSTS)){
   const row=doc.createElement('tr');
   for(const val of [x.label,rub(x.costKopecks)]){
    const td=doc.createElement('td');td.textContent=val;row.append(td);
   }
   body.append(row);
  }
  table.append(body);card.append(table);
  const foot=doc.createElement('p');
  foot.textContent='Источник: '+OWNER_COST_SOURCE+'. Ozon SKU 5023073005: в прежнем регистре 4 700 ₽, текущий норматив Vesta Cross 4 500 ₽. Историческая версия должна сохраняться до проверки периода.';
  card.append(foot);
  const anchor=section.querySelector('.page-heading');
  if(anchor)anchor.after(card);else section.prepend(card);
 }
}
if(typeof document!=='undefined')attachOwnerUnitCostReference();
