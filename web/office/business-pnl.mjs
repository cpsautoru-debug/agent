import {consolidateBusinessPnl} from './consolidated-pnl-core.mjs';
import {summarizeOzonProvisionalProfit} from './ozon-provisional-profit.mjs';
import {validateDashboardWbMonth} from './wb-month-settlement-ui.mjs';
import {financeRateBps,displayRate} from './channel-finance-metrics.mjs';
import {loadYandexDashboardEvidence,deriveYandexDashboardEvidence}
 from './yandex-dashboard-evidence.mjs';
import {yandexPnlCardMetric} from './yandex-pnl-card.mjs';
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
 summary.append(el('h2','','Финансовые показатели по каналам'),
  el('p','','Ozon и WB: результат после известных затрат. Яндекс: подтверждённый доход после услуг (пока без себестоимости). Общие расходы и налоги не распределяются до сверки.'));
 root.append(summary);
 const cards=el('div','business-pnl-cards');
 for(const ch of pnl.channels){
  const card=el('article','business-pnl-card');
  // This selects a display amount only; pnl.channels/knownChannelsTotal
  // remain unchanged, so income is never added as channel profit.
  const metric=yandexPnlCardMetric(ch,interim,pnl.month);
  card.append(el('h3','',labels[ch.id]),
   el('strong','',money(metric.primaryKopecks)),
   el('small','',metric.meaning));
  if(ch.id==='wb'&&interim.wb){
   const detail=interim.wb;
   // Show one primary management result. Keep the *pre-COGS* settlement
   // inside details, so it cannot look like a second channel profit.
   const fold=el('details','business-pnl-wb-details');
   fold.append(el('summary','','Удержания и детализация WB'));
   fold.append(el('small','business-pnl-subhead',
     'После удержаний WB, ДО себестоимости'),
    el('strong','business-pnl-interim-value',
      money(detail.amountKopecks)),
    el('small','business-pnl-interim-warning',detail.label));
   for(const [label,amount] of detail.breakdown){
    const row=el('div','business-pnl-wb-line');
    row.append(el('span','',label),el('strong','',money(amount)));
    fold.append(row);
   }
   card.append(fold);
  }
  if(metric.showIncome)
   card.append(el('small','business-pnl-interim-warning',metric.note));
  if(ch.id==='ozon'||ch.id==='wb'||ch.id==='yandex'){
   const link=el('a','business-pnl-detail-link',
     ch.id==='ozon'?'Подробная прибыль Ozon →':
     ch.id==='wb'?'Подробная экономика WB →':
      'Финансы Яндекс Маркета →');
   link.href=ch.id==='ozon'?'#ozonProfit':
    ch.id==='wb'?'#wbFinance':'#yandexFinance';
   card.append(link);
  }
    const evidence=sourceNotes[ch.id];
  if(evidence)card.append(el('small','business-pnl-evidence',evidence));
  cards.append(card);
 }
 root.append(cards);
 const sheet=el('div','business-pnl-sheet');
 const rows=[
  ['Результат после известных затрат ('+pnl.knownChannelCount+' из '+
   pnl.channels.length+' каналов: '+pnl.channels.filter(c=>c.status!=='unknown')
    .map(c=>labels[c.id]).join(' + ')+') — до общих расходов и налога',
   pnl.knownChannelsTotalKopecks],
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
 let serial=0,lastRender=null;
 function yandexInterim(evidence,sourceNotes,interim){
  if(evidence?.status!=='order_income_verified'||
     evidence.month!==monthInput.value)return;
  interim.yandex={month:evidence.month,
   incomeKopecks:evidence.incomeKopecks,orders:evidence.orders};
  sourceNotes.yandex=(evidence.serviceAuditComplete&&
   evidence.paymentAuditComplete?
    'Три финансовых архива проверены. ':
    'Услуги и платежи требуют сверки. ')+
   'Себестоимость, возвраты, налог ООО и внешние расходы — отдельно.';
 }
 function refreshYandexPanel(evidence){
  if(!lastRender||lastRender.month!==evidence?.month)return;
  yandexInterim(evidence,lastRender.sourceNotes,lastRender.interim);
  render(root,lastRender.pnl,lastRender.sourceNotes,lastRender.interim);
 }
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
    yandex:'Отчёты двух магазинов стороннего ООО исключены. Для ИП Жилиной Ольги отдельный расчёт Яндекса пока не подтверждён.',
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
  const yandexRead=loadYandexDashboardEvidence({month,fetcher}).then(
   evidence=>{yandexInterim(evidence,sourceNotes,interim);return evidence;});
  if(month==='2026-10'){
   // Both APIs are independent. Parallel reads eliminate an unnecessary
   // extra wait and keep the refresh visibly responsive.
   await Promise.all([yandexRead,
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
       const gr=data.result?.report?.groups;
       const sales=Array.isArray(gr)?gr.find(x=>x.name==='Продажи')?.amountKopecks:null;
       const returns=Array.isArray(gr)?gr.find(x=>x.name==='Возвраты')?.amountKopecks:null;
       const basis=Number.isSafeInteger(sales)&&Number.isSafeInteger(returns)?
         sales+returns:null;
       sourceNotes.ozon='Рентабельность после прямых затрат: '+
         displayRate(financeRateBps(ozon.beforeAllocationKopecks,basis))+'. '+
         (ozon.reviewWarnings?.length?
           'Совпадающие строки услуг требуют детальной проверки. ':
           'Начисления и себестоимость сверены. ')+
         'Итоговая прибыль всего бизнеса отдельно.';
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
      if(wb.managementCost?.status==='known_cost_result'){
       base.channels.wb={
        status:'known_cost_result',
        profitKopecks:wb.managementCost.contributionKopecks
       };
      }
      const basis=wb.breakdown[0][1]+wb.breakdown[1][1];
      sourceNotes.wb=wb.managementCost?
       'Себестоимость: '+wb.managementCost.confirmedSkuCount+
       ' артикулов; 6 подтверждённых возвратов. '+wb.reports+
       ' отчётов, '+wb.rows+
       ' операций. До внешней рекламы, общих расходов и налога ИП.':
       'Не полностью сверена себестоимость: '+wb.confirmedCostArticles+
       ' из '+wb.soldArticles+' артикулов. '+wb.reports+
       ' отчётов, '+wb.rows+' операций.';
     }catch(e){wbError=e;sourceNotes.wb='Нет полной сверенной расчётной суммы WB за выбранный период.';}
    })()
   ]);
  }
  if(month!=='2026-10')await yandexRead;
  if(serial!==id||monthInput.value!==month)return;
  refresh.disabled=false;
  refresh.textContent='Пересчитать сводку';
  root.removeAttribute('aria-busy');
  if(notice)notice.textContent='Пересчёт завершён · '+month;
  let pnl;
  try{pnl=consolidateBusinessPnl(base);}
  catch{root.textContent='Невозможно сформировать сводный отчёт: неверный период или данные.';return;}
  render(root,pnl,sourceNotes,interim);
  lastRender={month,pnl,sourceNotes,interim};
  if(error)root.append(el('p','business-pnl-disclaimer',
   'Источник Ozon недоступен. Показатели не подставляются из предыдущих периодов.'));
  if(wbError)root.append(el('p','business-pnl-disclaimer',
   'Расчётный источник WB недоступен. Выручка и прибыль WB не подставляются из других периодов.'));
 }
 window.addEventListener('yandex-financial-sources-audited',event=>{
  const d=event?.detail;
  if(d?.month!==monthInput.value)return;
  refreshYandexPanel(deriveYandexDashboardEvidence(d.month,d.sources));
 });
 window.addEventListener('yandex-auto-jobs-updated',()=>{
  const month=monthInput.value;
  if(!lastRender||lastRender.month!==month||lastRender.interim.yandex)return;
  void loadYandexDashboardEvidence({month,fetcher}).then(refreshYandexPanel);
 });
 refresh.addEventListener('click',load);
 monthInput.addEventListener('change',load);
 load();
 return true;
}
if(typeof document!=='undefined')attachBusinessPnl();
