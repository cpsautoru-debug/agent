import {consolidateBusinessPnl} from './consolidated-pnl-core.mjs';
import {summarizeOzonProvisionalProfit} from './ozon-provisional-profit.mjs';
import {validateDashboardWbMonth} from './wb-month-settlement-ui.mjs';
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
function render(root,pnl,sourceNotes={},interim={}){
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
  if(ch.id==='wb'&&interim.wb){
   const detail=interim.wb;
   card.append(el('small','business-pnl-subhead',
     'Расчёты после удержаний WB · до себестоимости'),
    el('strong','business-pnl-interim-value',money(detail.amountKopecks)),
    el('small','business-pnl-interim-warning',detail.label));
   const fold=el('details','business-pnl-wb-details');
   fold.append(el('summary','','Расшифровка удержаний WB'));
   for(const [label,amount] of detail.breakdown){
    const row=el('div','business-pnl-wb-line');
    row.append(el('span','',label),el('strong','',money(amount)));
    fold.append(row);
   }
   card.append(fold);
  }
  if(ch.id==='ozon'||ch.id==='wb'){
   const link=el('a','business-pnl-detail-link',
     ch.id==='ozon'?'Подробная прибыль Ozon →':
       'Подробная экономика WB →');
   link.href=ch.id==='ozon'?'#ozonProfit':'#wbFinance';
   card.append(link);
  }
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
  refresh.disabled=true;
  refresh.textContent='Пересчитываем…';
  root.setAttribute('aria-busy','true');
  let notice=documentRef.getElementById('businessPnlLoadStatus');
  if(notice)notice.textContent='Обновляем Ozon и Wildberries за '+month+'…';
  const base={month,channels:{},sharedExpenses:[],taxes:[],
    completeSources:false};
  const interim={};
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
  if(month==='2026-10'){
   // Both APIs are independent. Parallel reads eliminate an unnecessary
   // extra wait and keep the refresh visibly responsive.
   await Promise.all([
    (async()=>{
     try{
      const response=await fetcher('/api/ozon/profit?month='+encodeURIComponent(month),{
       method:'GET',credentials:'same-origin',cache:'no-store',
       signal:AbortSignal.timeout(16000)});
      if(!response.ok)throw Error('source_unavailable');
      const data=await response.json();
      const ozon=summarizeOzonProvisionalProfit(month,data);
      if(ozon.status==='provisional_known_cost_result'){
       base.channels.ozon={status:'known_cost_result',
         profitKopecks:ozon.beforeAllocationKopecks};
       sourceNotes.ozon=ozon.reviewWarnings?.length?
         'Совпадающие строки услуг Ozon требуют детальной проверки. '+
         'Промежуточный результат сверяется по общим суммам; это не окончательная прибыль.':
         'Начисления и себестоимость сверены. Банковское и налоговое закрытие отдельно.';
      }else sourceNotes.ozon='Недостаточно подтверждений: '+
        (ozon.missingEvidence?.join(', ')||'источники пока не сверены')+'.';
     }catch(e){error=e;}
    })(),
    (async()=>{
     try{
      const response=await fetcher('/api/wb/month-settlement?month='+encodeURIComponent(month),{
       method:'GET',credentials:'same-origin',cache:'no-store',
       signal:AbortSignal.timeout(16000)});
      if(!response.ok)throw Error('wb_month_settlement_unavailable');
      const wb=validateDashboardWbMonth(await response.json(),month);
      interim.wb=wb;
      sourceNotes.wb=wb.reports+' отчётов, '+wb.rows+
       ' операций. Себестоимость подтверждена для '+
       wb.confirmedCostArticles+' из '+wb.soldArticles+
       ' проданных артикулов ('+wb.preliminaryCostArticles+
       ' предварительно). Прибыль WB пока не рассчитана.';
     }catch(e){wbError=e;sourceNotes.wb='Нет полной сверенной расчётной суммы WB за выбранный период.';}
    })()
   ]);
  }
  if(serial!==id||monthInput.value!==month)return;
  refresh.disabled=false;
  refresh.textContent='Пересчитать сводку';
  root.removeAttribute('aria-busy');
  if(notice)notice.textContent='Пересчёт завершён · '+month;
  let pnl;
  try{pnl=consolidateBusinessPnl(base);}
  catch{root.textContent='Невозможно сформировать сводный отчёт: неверный период или данные.';return;}
  render(root,pnl,sourceNotes,interim);
  if(error)root.append(el('p','business-pnl-disclaimer',
   'Источник Ozon недоступен. Показатели не подставляются из предыдущих периодов.'));
  if(wbError)root.append(el('p','business-pnl-disclaimer',
   'Расчётный источник WB недоступен. Выручка и прибыль WB не подставляются из других периодов.'));
 }
 refresh.addEventListener('click',load);
 monthInput.addEventListener('change',load);
 load();
 return true;
}
if(typeof document!=='undefined')attachBusinessPnl();
