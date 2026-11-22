// Read-only finance coverage. No automatic mutations and no WB/Ozon sync calls.
import {assessFinanceCloseout} from './finance-closeout-core.mjs';
const rub=n=>new Intl.NumberFormat('ru-RU',{
  style:'currency',currency:'RUB'
}).format(n/100);
const dateRange=x=>x.validFrom+
  (x.validTo?' — '+x.validTo:' — далее');
const status=x=>x==='confirmed'?'Подтверждена':
  x==='preliminary'?'Предварительная':'Нет подтверждения';
const WARNINGS={
  wb_ozon_link_not_confirmed:'Связи конкретных SKU Ozon и артикулов WB не подтверждены.',
  advertising_not_integrated:'Реклама WB и Ozon ещё не объединена с финансовым расчётом.',
  tax_registry_not_integrated:'Налоговый регистр и налогоплательщик не сверены.',
  shared_expense_allocation_not_integrated:'Общие расходы не распределены между каналами.',
  wb_cost_migration_required:'Не создан отдельный справочник себестоимости WB.',
  ozon_profit_source_unavailable:'Версионный источник себестоимости Ozon Profit сейчас недоступен.',
  ozon_expense_source_unavailable:'Версионный регистр расходов Ozon Profit сейчас недоступен.',
  ozon_profit_costs_not_configured:'В Ozon Profit ещё нет документа себестоимости.',
  ozon_expenses_not_configured:'В Ozon Profit ещё нет документа общих расходов.',
  preliminary_costs_present:'Есть предварительные цены — это не подтверждённая себестоимость.',
  ozon_cost_sources_disagree:'Номинальные цены справочника Ozon и некоторых исторических версий Ozon Profit различаются — проверь сопоставимость периодов.',
  ozon_profit_sku_cards_missing:'Некоторые SKU из Ozon Profit отсутствуют в отдельном товарном справочнике: модель и идентичность не проверены.',
  ozon_catalog_sku_profit_missing:'Некоторые SKU из справочника товаров Ozon отсутствуют в загруженных версиях Ozon Profit.',
  material_delivery_possible_double_count:'Обнаружен риск двойного учёта доставки материалов между себестоимостью и накладными.'
};
export function renderUnifiedCostAudit(documentRef,data){
  if(data?.code!=='unified_finance_source_audit'||
    data.readOnly!==true||data.changedRecords!==0||
    data.source!=='WB_D1_PLUS_OZON_COSTS_PLUS_OZON_PROFIT_RPC'||
    data.netProfitKopecks!==null||
    data.canonicalSharedCatalogReady!==false||
    !['ready','migration_required'].includes(data.wb?.status)||
    !['ready','unavailable'].includes(data.ozonProfit?.status)||
    !['ready','unavailable'].includes(data.expenses?.status)||
    !Array.isArray(data.wb?.entries)||
    !Array.isArray(data.ozonCatalog?.entries)||
    !Array.isArray(data.ozonProfit?.entries)||
    !Array.isArray(data.expenses?.items)||
    !Array.isArray(data.blockers)||
    !Array.isArray(data.possibleArticleLinks)||
    data.skuCoverage?.status!=='source_coverage_only'||
    data.skuCoverage?.readOnly!==true||
    data.skuCoverage?.changedRecords!==0||
    !Number.isSafeInteger(data.skuCoverage?.distinctProfitSkus)||
    !Array.isArray(data.skuCoverage?.profitOnlySkus)||
    !Array.isArray(data.skuCoverage?.expensesReviewed)||
    data.skuCoverage.profitOnlySkuCount!==data.skuCoverage.profitOnlySkus.length||
    data.skuCoverage.expensesReviewed.length!==data.expenses.items.length)
    throw Error('invalid_finance_source_payload');
  const $=id=>documentRef.getElementById(id);
  const count=(x,confirmed)=>String(confirmed)+' / '+String(x);
  $('financeAuditWbCount').textContent=data.wb.status==='ready'?
    count(data.wb.count,data.wb.confirmed):'Нет справочника';
  $('financeAuditOzonCatalogCount').textContent=
    count(data.ozonCatalog.count,data.ozonCatalog.confirmed);
  $('financeAuditProfitCount').textContent=
    data.ozonProfit.status==='ready'?
      count(data.ozonProfit.count,data.ozonProfit.confirmed):
      'Источник недоступен';
  $('financeAuditExpenseCount').textContent=
    data.expenses.status==='ready'?
      String(data.expenses.configuredCount):'Источник недоступен';
  $('financeAuditScope').textContent=
    'Состояние источников на момент чтения. WB: '+data.wb.count+
    ' датированных записей; Ozon Profit: версия себестоимости '+
    data.ozonProfit.version+', версия расходов '+data.expenses.version+
    '. Точных совпадений кодов (только кандидаты): '+
    data.possibleArticleLinks.length+'. Признак одной модели, дата действия и состав стоимости должны быть подтверждены отдельно.';
  const closeout=assessFinanceCloseout(data);
  $('financeAuditWarnings').textContent=
    'ЗАКРЫТИЕ ПЕРИОДА: WB — НЕ ПОДТВЕРЖДЕНО. Причины: '+
    closeout.wbReasons.join(' ')+
    ' OZON — НЕ ПОДТВЕРЖДЕНО. Причины: '+
    closeout.ozonReasons.join(' ')+
    ' Другие ограничения: '+
    data.blockers.map(x=>WARNINGS[x]||'Есть непроверенный источник данных.')
      .filter((x,i,a)=>a.indexOf(x)===i).join(' ');
  const node=(tag,value)=>{
    const n=documentRef.createElement(tag);
    if(value!==undefined)n.textContent=String(value);
    return n;
  };
  const table=(id,rows,total)=>{
    const host=$(id);host.replaceChildren();
    for(const values of rows.slice(0,100)){
      const row=node('tr');
      for(const v of values)row.append(node('td',v));
      host.append(row);
    }
    if(!rows.length){
      const tr=node('tr');
      tr.append(node('td','Нет сохранённых данных из этого источника. Не означает нулевые расходы или себестоимость.'));
      host.append(tr);
    }else if(total>100){
      const tr=node('tr');
      tr.append(node('td','Показаны первые 100 из '+total+
        ' записей. Счётчики учитывают все прочитанные данные.'));
      host.append(tr);
    }
  };
  const costs=[
    ...data.wb.entries.map(x=>[
      'WB · финансовая D1',x.vendorCode,dateRange(x),
      rub(x.costKopecks),status(x.status)
    ]),
    ...data.ozonCatalog.entries.map(x=>[
      'Ozon · справочник товаров',x.sellerArticle+' (SKU '+x.sku+')',
      x.model,rub(x.costKopecks),status(x.status)
    ]),
    ...data.ozonProfit.entries.map(x=>[
      'Ozon · используемый Profit',x.sku,dateRange(x),
      rub(x.costKopecks),status(x.status)
    ])
  ];
  table('financeAuditCostRows',costs,costs.length);
  const coverage=data.skuCoverage;
  const coverageAvailable=data.ozonProfit.status==='ready';
  $('financeAuditUniqueProfitSkus').textContent=coverageAvailable?
    String(coverage.distinctProfitSkus):'Источник недоступен';
  $('financeAuditProfitOnlySkus').textContent=coverageAvailable?
    String(coverage.profitOnlySkuCount):'Источник недоступен';
  $('financeAuditCatalogOnlySkus').textContent=coverageAvailable?
    String(coverage.catalogOnlySkuCount):'Невозможно сверить';
  $('financeAuditIntersectSkus').textContent=coverageAvailable?
    String(coverage.intersectedSkus):'Невозможно сверить';
  const missing=coverage.profitOnlySkus.flatMap(x=>x.periods.map(p=>[
    x.sku,String(x.versionCount),dateRange(p),
    rub(p.costKopecks),status(p.status)
  ]));
  table('financeAuditProfitOnlyRows',missing,missing.length);
  $('financeAuditSkuCoverageNote').textContent=coverageAvailable?
    'В Ozon Profit прочитано '+coverage.profitCostVersionCount+
    ' датированных версий по '+coverage.distinctProfitSkus+
    ' уникальным SKU. Только в Profit: '+coverage.profitOnlySkuCount+
    '; только в справочнике: '+coverage.catalogOnlySkuCount+
    '. Источники не доказывают ни модель, ни соответствие товару WB; цены не переносятся.':
    'Версионный источник Ozon Profit недоступен. Отсутствие результата не равно нулю SKU.';
  const expenseRisk={
    possible_duplicate_material_delivery:
      'Риск дубля: доставка материалов уже включена в часть себестоимостей Ozon Profit',
    material_delivery_in_cogs_unknown:
      'Неизвестно, включена ли доставка материалов в себестоимость',
    material_delivery_requires_document_check:
      'Доставка материалов: необходима сверка первички и состава себестоимости',
    cross_channel_allocation_unconfirmed:
      'Общий расход: распределение между WB и Ozon не подтверждено',
    direct_ozon_document_unconfirmed:
      'Прямой расход Ozon: не подтверждён фактическим платежом'
  };
  const expenses=coverage.expensesReviewed.map(x=>[
    x.label,
    x.scope==='business'?'Общая для бизнеса':'Только Ozon',
    rub(x.amountKopecks)+' (в документе, не факт платежа)',
    dateRange(x),expenseRisk[x.risk]||'Необходимо подтверждение источника'
  ]);
  table('financeAuditExpenseRows',expenses,expenses.length);
  $('financeAuditOverheadReview').textContent=data.expenses.status==='ready'?
    'Записей в регистре: '+coverage.expensesReviewed.length+
    '; требуют специальной сверки доставки материалов: '+
    coverage.materialDeliveryCandidates+'. Ни одна сумма из этого списка '+
    'не признана фактическим платежом и не распределена повторно в общий P&L.':
    'Регистр расходов Ozon Profit недоступен: нельзя считать общие расходы нулевыми.';
  const differences=data.ozonProfitCrosschecks?.filter(
    x=>x.sameNominalCost===false).length||0;
  $('financeAuditStatus').textContent='Источники прочитаны. '+
    'WB цен: '+data.wb.count+'; Ozon-справочник: '+
    data.ozonCatalog.count+'; действующих версий Ozon Profit: '+
    (data.ozonProfit.status==='ready'?data.ozonProfit.count:'недоступно')+
    '; номинальных расхождений цен Ozon: '+differences+
    '. Это сверка, не единый утверждённый реестр и не чистая прибыль.';
}
export function attachUnifiedCostAudit({
  documentRef=typeof document==='undefined'?null:document,
  windowRef=typeof window==='undefined'?null:window,
  fetchSource=typeof fetch==='undefined'?null:fetch,
  now=Date.now
}={}){
  const $=id=>documentRef?.getElementById(id);
  const button=$('financeAuditRefresh');
  if(!button||!windowRef||!fetchSource)return false;
  const ids=['financeAuditStatus','financeAuditCostRows',
    'financeAuditExpenseRows','financeAuditWbCount','financeAuditOzonCatalogCount',
    'financeAuditProfitCount','financeAuditExpenseCount','financeAuditScope',
    'financeAuditWarnings','financeAuditUniqueProfitSkus',
    'financeAuditProfitOnlySkus','financeAuditCatalogOnlySkus',
    'financeAuditIntersectSkus','financeAuditProfitOnlyRows',
    'financeAuditSkuCoverageNote','financeAuditOverheadReview'];
  if(ids.some(id=>!$(id)))return false;
  let busy=false,last=0;
  const active=()=>windowRef.location?.hash?.split('/')[0]==='#wbFinance'&&
    documentRef.visibilityState!=='hidden';
  const reset=()=>{
    for(const id of ['financeAuditWbCount','financeAuditOzonCatalogCount',
      'financeAuditProfitCount','financeAuditExpenseCount'])$(id).textContent='—';
    $('financeAuditCostRows').replaceChildren();
    $('financeAuditExpenseRows').replaceChildren();
    $('financeAuditProfitOnlyRows').replaceChildren();
    for(const id of ['financeAuditUniqueProfitSkus','financeAuditProfitOnlySkus',
      'financeAuditCatalogOnlySkus','financeAuditIntersectSkus'])
      $(id).textContent='—';
    $('financeAuditSkuCoverageNote').textContent=
      'Нет подтверждённой сверки каталога SKU.';
    $('financeAuditOverheadReview').textContent=
      'Риск двойного учёта общих расходов не проверен.';
    $('financeAuditScope').textContent='Статус источников не подтверждён.';
    $('financeAuditWarnings').textContent=
      'Себестоимость, реклама, налог и общие расходы не могут считаться нулевыми.';
  };
  async function load(force=false){
    if(busy||!active()||!force&&now()-last<300000)return;
    busy=true;button.disabled=true;
    $('financeAuditStatus').textContent='Проверяем источники WB, Ozon и версионный регистр расходов…';
    try{
      const response=await fetchSource('/api/finance/cost-audit',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(15000)
      });
      if(!response.ok)throw Error('finance_source_api_unavailable');
      const data=await response.json();
      renderUnifiedCostAudit(documentRef,data);
      last=now();
    }catch{
      reset();
      $('financeAuditStatus').textContent=
        'Не удалось подтвердить общий обзор источников. '+
        'Финансовый монитор WB и расчёт Ozon работают отдельно. '+
        'Попробуй обновить источники после проверки входа владельца.';
    }finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',()=>{void load(true);});
  windowRef.addEventListener('hashchange',()=>{void load();});
  documentRef.addEventListener('visibilitychange',()=>{void load();});
  if(active())void load();
  return true;
}
if(typeof document!=='undefined'&&typeof window!=='undefined')
  attachUnifiedCostAudit();
