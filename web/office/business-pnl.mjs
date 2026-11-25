import {consolidateBusinessPnl} from './consolidated-pnl-core.mjs?v=20261124-three-marketplaces';
import {summarizeOzonProvisionalProfit} from './ozon-provisional-profit.mjs';
import {validateDashboardWbMonth} from './wb-month-settlement-ui.mjs';
import {financeRateBps,displayRate} from './channel-finance-metrics.mjs';
import {loadYandexDashboardEvidence,deriveYandexDashboardEvidence}
 from './yandex-dashboard-evidence.mjs';
import {yandexPnlCardMetric} from './yandex-pnl-card.mjs?v=20261124-margin-first';
import {loadYandexCostSnapshot} from './yandex-snapshot-dashboard.mjs?v=20261124-direct-cost-review-v2';
import {applyYandexCostToChannels} from './marketplace-channel-scope.mjs';
import {readOctoberBusinessOverhead} from './business-overhead-core.mjs';
const labels={ozon:'Ozon',wb:'Wildberries',yandex:'Яндекс Маркет'};
const money=x=>Number.isSafeInteger(x)?new Intl.NumberFormat('ru-RU',
 {style:'currency',currency:'RUB'}).format(x/100):'Нет данных';
const el=(tag,cls,value)=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(value!==undefined)node.textContent=value;
 return node;
};
function renderCloseoutStatus(root,pnl,interim){
 const section=el('section','business-pnl-closeout-status');
 section.id='marketplaceCloseoutStatus';
 const known=pnl.channels.filter(x=>x.status!=='unknown');
 const yandex=pnl.channels.find(x=>x.id==='yandex');
 section.append(el('h3','','Готовность управленческого учёта · '+pnl.month),
  el('p','','Финансовый результат после прямых затрат подтверждён источниками: '+
   known.length+' из 3 маркетплейсов. Отсутствующий канал не считается нулевым.'));
 if(Number.isSafeInteger(pnl.knownChannelsTotalKopecks))
  section.append(el('p','','Известный промежуточный результат ('+
   known.map(x=>labels[x.id]).join(' + ')+'): '+
   money(pnl.knownChannelsTotalKopecks)+
   ' · до АУСН, общих расходов и неполных источников. НЕ чистая прибыль.'));
 const blockers=[];
 if(yandex?.status==='unknown'){
  const cost=interim.yandexCost;
  const why=cost?.status==='incomplete_cost_coverage'?
   (cost.missingCount===0?
    'все распознанные товары имеют себестоимость, но не хватает подтверждения полноты реализаций/возвратов':
    'есть товары с неизвестной себестоимостью')+
    (Number.isSafeInteger(cost.missingCount)?
     ' (неопознанных товаров: '+cost.missingCount+')':'')+
    (Number.isSafeInteger(cost.issues)?
     ', проблем источников: '+cost.issues:''):
   cost?.status==='unavailable'?
    'официальный расчёт прямых затрат пока не получен':
    'отчёты доходов и датированная себестоимость ещё не сведены';
  blockers.push('Яндекс: '+why);
 }
 if(interim.tax?.code==='marketplace_tax_management_estimate'){
  if(interim.tax.wb?.complete!==true)
   blockers.push('АУСН WB: отсутствует полная валовая выручка с возвратами и взаимозачётами; оценки налога не подтверждают базу ('+
    (interim.tax.wb?.savedReports??'?')+' XLSX / '+
    (interim.tax.wb?.apiReports??'?')+' API-отчётов)');
  if(interim.tax.ozon?.status!=='tax_base_reconciled')
   blockers.push('АУСН Ozon: бонусы, компенсации и даты признания доходов ещё не классифицированы');
  if(interim.tax.yandex?.status!=='tax_base_reconciled')
   blockers.push('АУСН Яндекса: оценка валовых заказов не учитывает все возвраты и даты поступлений');
 }else blockers.push('Единый налог АУСН: источник полной базы ещё не загружен');
 if(!interim.overhead)
  blockers.push('Общие расходы: регистр за этот месяц не подтверждён');
 else if(interim.overhead.freightOverlapPossible)
  blockers.push('Доставка материалов: возможное пересечение с производственной себестоимостью');
 if(!blockers.length&&pnl.finalProfitKopecks===null)
  blockers.push('Финальный статус требует проверки состава расходов и источников доходов');
 const list=el('ul','business-pnl-open-items');
 for(const item of blockers)list.append(el('li','',item));
 section.append(el('p','','Незакрытые источники ('+blockers.length+'):'));
 section.append(list);
 section.append(el('p','business-pnl-disclaimer',
  'Оперативный финансовый экран, а не декларация ФНС. '+
  'Ожидаемые или неизвестные суммы не приравниваются к 0 ₽.'));
 root.append(section);
}
function render(root,pnl,sourceNotes={},interim={}){
 root.replaceChildren();
 const summary=el('div','business-pnl-heading');
 summary.append(el('h2','','Финансовые показатели трёх маркетплейсов'),
  el('p','','В расчёте только Ozon, Wildberries и Яндекс Маркет. Сначала результат после комиссий и себестоимости каждого канала, затем дополнительные расходы и налог ИП — по одному разу. Авито и «Пламя» исключены.'));
 root.append(summary);
 renderCloseoutStatus(root,pnl,interim);
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
  if(Number.isSafeInteger(metric.incomeKopecks))
   card.append(el('small','business-pnl-subhead',
    'Доход после услуг до себестоимости: '+money(metric.incomeKopecks)));
  if(ch.id==='yandex'&&interim.yandexCost?.month===pnl.month){
   const x=interim.yandexCost;
   if(x.status==='preliminary_cost_reconciled'){
    card.append(el('small','business-pnl-subhead',
     'Подтверждённая себестоимость доставленных: '+money(x.cogsKopecks)));
   }else if(x.status==='incomplete_cost_coverage'){
    card.append(el('small','business-pnl-interim-warning',
     (x.missingCount===0?
      'Цены всех распознанных товаров Яндекса подтверждены, но нельзя подтвердить полноту себестоимости без всех отчётов реализации и возвратов.':
      'Себестоимость Яндекса не закрыта: товаров без подтверждённой цены '+x.missingCount+'.')+
      ' Проблем покрытия отчётов: '+x.issues+'.'));
    if(Array.isArray(x.missingProducts)&&x.missingProducts.length){
     const fold=el('details','business-pnl-wb-details');
     fold.append(el('summary','','Товары без подтверждённой себестоимости · '+
      x.missingProducts.length));
     fold.open=true;
     const list=el('ol','');
     for(const item of x.missingProducts){
      list.append(el('li','',
       (item.name||'Без названия')+' · артикул '+item.shopSku+
       (item.partnerId?' · магазин '+item.partnerId:'')+
       (Number.isSafeInteger(item.deliveredUnits)?
        ' · доставлено '+item.deliveredUnits+' шт.':'')+
       ' · себестоимость 1 шт. не подтверждена'));
     }
     fold.append(list);
    fold.append(el('p','business-pnl-interim-warning',
     'Не вводите произвольную цену: требуется фактическая стоимость '+
     'материала и пошива именно этой комплектации. Отсутствующие '+
     'товары не считаются бесплатными.'));
    card.append(fold);
    }
    if(Array.isArray(x.blockers)&&x.blockers.length){
     const hints={
      service_amount_coverage_incomplete:'Неполное покрытие сумм отчёта услуг',
      payment_coverage_incomplete:'Не все платежи имеют проверенную сумму',
      both_shops_delivery_return_cost_incomplete:'Нет подтверждения реализаций и возвратов обоих магазинов',
      financial_sources_not_verified:'Проверка финансовых архивов не завершена',
      three_reports_not_verified:'Не совпадают необходимые финансовые отчёты',
      order_income_not_verified:'Не подтверждён доход по заказам'
     };
     const distinct=[...new Set(x.blockers)];
     const items=el('div','business-pnl-interim-warning');
     items.append(el('small','','Дополнительные блокеры расчёта:'));
     for(const key of distinct)
      items.append(el('small','',hints[key]||key));
     card.append(items);
    }
    if(Array.isArray(x.issueDetails)&&x.issueDetails.length){
     const names={149082506:'САД',149106500:'автосклад'};
     const explanations={
      source_no_data:'API Яндекса не вернул данные реализации для этого магазина',
      source_missing:'Не получен официальный отчёт реализации',
      delivered_sheet_missing:'В архиве отсутствует лист доставленных товаров',
      returned_sheet_missing:'В архиве отсутствует лист возвращённых товаров',
      delivered_sku_coverage_incomplete:'В отчёте доставок есть неопознанные SKU',
      returned_sku_coverage_incomplete:'В отчёте возвратов есть неопознанные SKU'
     };
     const details=el('div','business-pnl-interim-warning');
     details.append(el('small','','Проблемы исходных отчётов:'));
     for(const issue of x.issueDetails)
      details.append(el('small','',
       (names[issue.partnerId]||'Магазин '+issue.partnerId)+
       ': '+(explanations[issue.reason]||issue.reason)));
     card.append(details);
    }
   }
  }
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
  ['Сумма результатов трёх маркетплейсов после прямых затрат',pnl.channelsTotalKopecks],
  ...pnl.sharedExpenses.map(x=>[x.label,-x.amountKopecks]),
  ...pnl.taxes.map(x=>[x.label,-x.amountKopecks]),
  // This number is an arithmetic difference over only visible known
  // contributions minus the shown shared costs and the WHOLE-IP tax. It
  // cannot be interpreted as the profit of those specific channels.
  ...(pnl.channelsTotalKopecks===null?
   [['Остаток известных строк (без неподтверждённых каналов) — НЕ прибыль',
     pnl.visibleRowsRemainderKopecks]]:
   [['Предварительный итог после дополнительных расходов и налога ИП — НЕ чистая прибыль',
     pnl.provisionalAfterExpensesKopecks]]),
  ['ЧИСТАЯ ПРИБЫЛЬ ТРЁХ МАРКЕТПЛЕЙСОВ · ПОСЛЕ СВЕРКИ',
    pnl.finalProfitKopecks]
 ];
 for(const [label,value] of rows){
  const row=el('div','business-pnl-row');
  row.append(el('span','',label),el('strong','',money(value)));
  sheet.append(row);
 }
 root.append(sheet);
 // Display three marketplace tax scenarios as evidence only; the canonical
 // consolidated P&L keeps taxes null until all three sources are complete.
 if(interim.tax?.code==='marketplace_tax_management_estimate'&&
    interim.tax.month===pnl.month){
  const t=interim.tax;
  const section=el('section','business-pnl-tax-evidence');
  section.append(el('h3','','АУСН 8% · оценка по данным маркетплейсов'));
  for(const [name,obj,amount] of [
   ['Ozon',t.ozon,t.ozon?.taxEstimateKopecks],
   ['Wildberries',t.wb,t.wb?.savedTaxEstimateKopecks],
   ['Яндекс Маркет',t.yandex,t.yandex?.taxEstimateKopecks]]){
   const row=el('p','',''+name+': '+money(amount)+
    ' · источник '+String(obj?.status||'не определён'));
   section.append(row);
  }
  section.append(el('p','business-pnl-disclaimer',
   'Это три предварительные оценки одного ИП. Wildberries основан на '+
   (t.wb?.savedReports??'?')+' XLSX из '+(t.wb?.apiReports??'?')+
   ' API-отчётов; Яндекс — до подтверждения возвратов; Ozon — до '+
   'классификации бонусов. Итог АУСН и чистая прибыль не вычитаются '+
   'из сводного P&L, пока налоговая база не сверена. Комиссии не '+
   'уменьшают доходы АУСН.'));
  root.append(section);
 }
 if(interim.overhead)
  root.append(el('p','business-pnl-subhead',
   'Дополнительные расходы: подтверждённый реестр Ozon Profit D1, версия '+
   interim.overhead.version+
   '. Показаны только расходы бизнеса, не удержания маркетплейсов.'+
   (interim.overhead.freightOverlapPossible?
    ' Возможное повторное включение доставки материала в себестоимость требует сверки.':'')));
 root.append(el('p','business-pnl-disclaimer',
  pnl.finalProfitKopecks===null?
   'Чистая прибыль трёх маркетплейсов пока не подтверждена. '+
   (pnl.missingChannels.length?
    'Не завершена себестоимость и/или прямые расходы: '+
     pnl.missingChannels.map(x=>labels[x]).join(', ')+'. ':
    'Результаты после прямых затрат предварительные. ')+
   'Общие расходы и налог АУСН вычитаются однократно; налог относится ко всему ИП и может включать деятельность вне этих трёх каналов. Неизвестные расходы не заменяются нулями.':
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
   'Себестоимость, возвраты, налог ИП и внешние расходы — отдельно.';
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
  if(notice)notice.textContent='Обновляем Ozon, Wildberries и Яндекс за '+month+'…';
  const base={month,channels:{},sharedExpenses:[],taxes:[],
    completeSources:false};
  const interim={};
  const sourceNotes={
    ozon:'Ожидает расчёт по сверенным данным.',
    wb:'Данные прибыли пока не подтверждены.',
    yandex:'Доход после услуг подтверждён отдельно; себестоимость и расходы проверяются.'
  };
  if(month==='2026-10'){
   // Known owner-confirmed expenses, but not an audited exhaustive business ledger.
   base.sharedExpenses=[
    {id:'shared-waste',label:'Мусор',amountKopecks:900000},
    {id:'shared-leather-delivery',label:'Доставка кожи',amountKopecks:2000000},
    {id:'shared-remote-salary',label:'Зарплата Ильи',amountKopecks:2500000}
   ];
   // Tax is supplied by marketplace income evidence, not a fixed owner-wide charge.
   // Until the full IP base is reconciled keep consolidated tax unknown.
   base.taxes=[];
  }
  let error=null,wbError=null;
  const yandexRead=loadYandexDashboardEvidence({month,fetcher}).then(
   evidence=>{yandexInterim(evidence,sourceNotes,interim);return evidence;});
  const taxRead=(async()=>{
   try{
    const r=await fetcher('/api/finance/marketplace-tax-estimate?month='+
     encodeURIComponent(month),{method:'GET',credentials:'same-origin',
     cache:'no-store',signal:AbortSignal.timeout(28000)});
    if(!r.ok)return;
    const data=await r.json();
    if(data?.code==='marketplace_tax_management_estimate'&&
       data.month===month&&data.officialTaxVerified===false&&
       data.totalTaxKopecks===null&&id===serial){
     interim.tax=data;
     if(lastRender?.base===base&&lastRender.month===month){
      lastRender.pnl=consolidateBusinessPnl(base);
      render(root,lastRender.pnl,sourceNotes,interim);
     }
    }
   }catch{/* The tax panel remains explicitly incomplete. */}
  })();
  const overheadRead=(async()=>{
   if(month!=='2026-10')return;
   try{
    const response=await fetcher('/api/finance/cost-audit?month='+
     encodeURIComponent(month),{method:'GET',
      credentials:'same-origin',cache:'no-store',
      signal:AbortSignal.timeout(16000)});
    if(!response.ok)return;
    const ledger=readOctoberBusinessOverhead(month,await response.json());
    if(ledger&&id===serial&&monthInput.value===month){
     base.sharedExpenses=ledger.items;
     interim.overhead=ledger;
    }
   }catch{/* Retain known owner amounts as provisional, not unknown zero. */}
  })();
  const yandexCosts=loadYandexCostSnapshot(month,fetcher).then(x=>{
   if(serial!==id||monthInput.value!==month)return x;
   interim.yandexCost=x;
   applyYandexCostToChannels(base.channels,month,x);
   if(x.status==='preliminary_cost_reconciled')
    sourceNotes.yandex='Сверены доставленные SKU и их себестоимость. Результат до дополнительной рекламы, периода возвратов, услуг и АУСН.';
   else if(x.status==='incomplete_cost_coverage')
    sourceNotes.yandex='Сверка себестоимости Яндекса ещё не завершена. Неизвестные товары не считаются нулевыми затратами.';
   else if(x.status==='unavailable')
    sourceNotes.yandex='Серверная сверка себестоимости Яндекса пока недоступна. Доход после услуг не считается прибылью без фактических SKU и расходов.';
   if(lastRender?.base===base&&lastRender.month===month){
    lastRender.pnl=consolidateBusinessPnl(base);
    render(root,lastRender.pnl,sourceNotes,interim);
   }
   return x;
  });
  if(month==='2026-10'){
   // Both APIs are independent. Parallel reads eliminate an unnecessary
   // extra wait and keep the refresh visibly responsive.
   await Promise.all([yandexRead,overheadRead,taxRead,
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
  lastRender={month,pnl,sourceNotes,interim,base};
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
 window.addEventListener('yandex-month-evidence-saved',()=>{
  const month=monthInput.value;
  if(!lastRender||lastRender.month!==month)return;
  void loadYandexCostSnapshot(month,fetcher).then(x=>{
   if(lastRender?.month!==month||x.status==='unavailable')return;
   lastRender.interim.yandexCost=x;
   applyYandexCostToChannels(lastRender.base.channels,month,x);
   lastRender.pnl=consolidateBusinessPnl(lastRender.base);
   render(root,lastRender.pnl,lastRender.sourceNotes,lastRender.interim);
  });
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
