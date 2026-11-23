import {consolidateBusinessPnl} from './consolidated-pnl-core.mjs';
import {summarizeOzonProvisionalProfit} from './ozon-provisional-profit.mjs';
import {describeDashboardWbEvidence} from './business-pnl-source-evidence.mjs';
const labels={ozon:'Ozon',wb:'Wildberries',yandex:'Яндекс Маркет',
 avito:'Авито',offline:'Магазин · Пламя'};
const money=x=>Number.isSafeInteger(x)?new Intl.NumberFormat('ru-RU',
 {style:'currency',currency:'RUB'}).format(x/100):'Нет данных';
const el=(tag,cls,value)=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(value!==undefined)node.textContent=value;
 return node;
};
function render(root,pnl,sourceNotes={}){
 root.replaceChildren();
 const summary=el('div','business-pnl-heading');
 summary.append(el('h2','','Финансовый результат по каналам'),
  el('p','','Сначала результат каждого канала после его прямых затрат. Затем общие расходы и налоги — один раз.'));
 root.append(summary);
 const cards=el('div','business-pnl-cards');
 for(const ch of pnl.channels){
  const card=el('article','business-pnl-card');
  card.append(el('h3','',labels[ch.id]),
   el('strong','',money(ch.profitKopecks)),
   el('small','',ch.status==='known_cost_result'?
     'По известным затратам · не чистая прибыль':
     ch.status==='verified'?'Подтверждено':'Нет закрытого расчёта'));
  const evidence=sourceNotes[ch.id];
  if(evidence)card.append(el('small','business-pnl-evidence',evidence));
  cards.append(card);
 }
 root.append(cards);
 const sheet=el('div','business-pnl-sheet');
 const rows=[
  ['Сумма результатов всех каналов',pnl.channelsTotalKopecks],
  ...pnl.sharedExpenses.map(x=>[x.label,-x.amountKopecks]),
  ...pnl.taxes.map(x=>[x.label,-x.amountKopecks]),
  // Do not print subtotals as additional deductions: the rows above
  // already display each one-time common expense and entity tax.
  ['ИТОГОВАЯ ПРИБЫЛЬ БИЗНЕСА',pnl.finalProfitKopecks]
 ];
 for(const [label,value] of rows){
  const row=el('div','business-pnl-row');
  row.append(el('span','',label),el('strong','',money(value)));
  sheet.append(row);
 }
 root.append(sheet);
 root.append(el('p','business-pnl-disclaimer',
  pnl.finalProfitKopecks===null?
   'Итог пока не рассчитывается: не закрыта прибыль всех каналов и/или не подтверждён полный перечень общих расходов и налогов. Показаны только известные расходы; неизвестные суммы не заменяются нулями.':
   pnl.verified?'Все источники подтверждены.':'Управленческая оценка: имеются неподтверждённые источники.'));
}
export function attachBusinessPnl({documentRef=document,fetcher=fetch}={}){
 const root=documentRef.getElementById('businessPnl');
 const monthInput=documentRef.getElementById('ceoMonth');
 const refresh=documentRef.getElementById('businessPnlRefresh');
 if(!root||!monthInput||!refresh)return false;
 let serial=0;
 async function load(){
  const id=++serial,month=monthInput.value;
  const base={month,channels:{},sharedExpenses:[],taxes:[],
    completeSources:false};
  const sourceNotes={
    ozon:'Ожидает расчёт по сверенным данным.',
    wb:'Данные прибыли пока не подтверждены.',
    yandex:'Нет подключённого подтверждённого P&L за этот месяц.',
    avito:'Нет подключённого подтверждённого P&L за этот месяц.',
    offline:'Нет подключённого подтверждённого P&L за этот месяц.'
  };
  if(month==='2026-10'){
   // Known owner-confirmed expenses, but not an audited exhaustive business ledger.
   base.sharedExpenses=[
    {id:'shared-waste',label:'Мусор',amountKopecks:900000},
    {id:'shared-leather-delivery',label:'Доставка кожи',amountKopecks:2000000},
    {id:'shared-remote-salary',label:'Зарплата Ильи',amountKopecks:2500000}
   ];
   base.taxes=[{id:'ip-ausn',label:'Налог ИП · АУСН 8%',
     entity:'ip',amountKopecks:20550700}];
  }
  let error=null,wbError=null;
  try{
   if(month==='2026-10'){
    const response=await fetcher('/api/ozon/profit?month='+encodeURIComponent(month),{
     credentials:'same-origin',cache:'no-store',
     signal:AbortSignal.timeout(16000)});
    if(!response.ok)throw Error('source_unavailable');
    const data=await response.json();
    const ozon=summarizeOzonProvisionalProfit(month,data);
    if(ozon.status==='provisional_known_cost_result')
     base.channels.ozon={status:'known_cost_result',
       profitKopecks:ozon.beforeAllocationKopecks};
    else sourceNotes.ozon='Недостаточно подтверждений: '+
      (ozon.missingEvidence?.join(', ')||'источники пока не сверены')+'.';

   }
  }catch(e){error=e;}
  if(month==='2026-10'){
   try{
    const response=await fetcher('/api/finance/income-evidence?month='+encodeURIComponent(month),{
     method:'GET',credentials:'same-origin',cache:'no-store',
     signal:AbortSignal.timeout(16000)});
    if(!response.ok)throw Error('wb_income_source_unavailable');
    sourceNotes.wb=describeDashboardWbEvidence(await response.json(),month);
   }catch(e){wbError=e;sourceNotes.wb='Нет проверенной сводки WB за выбранный период.';}
  }
    if(serial!==id||monthInput.value!==month)return;
  let pnl;
  try{pnl=consolidateBusinessPnl(base);}
  catch{root.textContent='Невозможно сформировать сводный отчёт: неверный период или данные.';return;}
  render(root,pnl,sourceNotes);
  if(error)root.append(el('p','business-pnl-disclaimer',
   'Источник Ozon недоступен. Показатели не подставляются из предыдущих периодов.'));
  if(wbError)root.append(el('p','business-pnl-disclaimer',
   'Диагностика WB временно недоступна. Прибыль WB не подставляется.'));
 }
 refresh.addEventListener('click',load);
 monthInput.addEventListener('change',load);
 load();
 return true;
}
if(typeof document!=='undefined')attachBusinessPnl();
