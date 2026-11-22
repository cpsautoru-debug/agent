// Closing a period requires evidence beyond API availability or passing tests.
// This is a read-only decision aid, never a P&L calculation or approval.
const safeCount=x=>Number.isSafeInteger(x)&&x>=0;
export function assessFinanceCloseout(data){
  if(data?.code!=='unified_finance_source_audit'||data.readOnly!==true||
    data.netProfitKopecks!==null||!Array.isArray(data.blockers)||
    !['ready','migration_required'].includes(data.wb?.status)||
    !['ready','unavailable'].includes(data.ozonProfit?.status)||
    !['ready','unavailable'].includes(data.expenses?.status)||
    ![data.wb?.count,data.wb?.confirmed,data.ozonProfit?.count,
      data.ozonProfit?.confirmed,data.ozonCatalog?.count,
      data.ozonCatalog?.confirmed].every(safeCount)||
    !safeCount(data.skuCoverage?.profitOnlySkuCount)||
    !safeCount(data.skuCoverage?.catalogOnlySkuCount))
    throw Error('invalid_finance_closeout_source');
  const wb=[];
  const ozon=[];
  const both=[
    'Официальные выплаты за выбранный закрытый период не сверены с начислениями и удержаниями.',
    'Реклама, налоги и общие расходы не подтверждены и не согласованы с периодом.',
    'Версионная себестоимость должна соответствовать датам каждой продажи и возврата.'
  ];
  if(data.wb.status!=='ready')wb.push('Не готов справочник себестоимости WB.');
  else if(!data.wb.count)wb.push('Нет подтверждённых записей себестоимости WB.');
  else if(data.wb.confirmed!==data.wb.count)
    wb.push('Есть неподтверждённые версии себестоимости WB: '+
      (data.wb.count-data.wb.confirmed)+'.');
  if(data.ozonProfit.status!=='ready'||!data.ozonProfit.count)
    ozon.push('Версионная себестоимость Ozon Profit недоступна или пуста.');
  else if(data.ozonProfit.confirmed!==data.ozonProfit.count)
    ozon.push('Есть предварительные версии себестоимости Ozon Profit: '+
      (data.ozonProfit.count-data.ozonProfit.confirmed)+'.');
  if(data.ozonCatalog.confirmed!==data.ozonCatalog.count)
    ozon.push('Есть неподтверждённые товары в справочнике Ozon: '+
      (data.ozonCatalog.count-data.ozonCatalog.confirmed)+'.');
  if(data.skuCoverage.profitOnlySkuCount)
    ozon.push('SKU из Ozon Profit без карточек в товарном справочнике: '+
      data.skuCoverage.profitOnlySkuCount+'. Это не означает отсутствия себестоимости.');
  if(data.skuCoverage.catalogOnlySkuCount)
    ozon.push('SKU справочника без версии в Ozon Profit: '+
      data.skuCoverage.catalogOnlySkuCount+'. Наличие продаж по ним не подтверждено.');
  if(data.expenses.status!=='ready')
    ozon.push('Регистр общих расходов Ozon Profit недоступен.');
  else if(!safeCount(data.expenses.configuredCount)||!data.expenses.configuredCount)
    ozon.push('Регистр расходов Ozon Profit пуст; отсутствие записей не означает нулевые расходы.');
  if(data.blockers.includes('material_delivery_possible_double_count'))
    ozon.push('Не исключён двойной учёт доставки материалов.');
  // A WB-to-Ozon identity link is NOT a prerequisite for independent
  // marketplace profitability, so it does not close or block either period.
  return {
    readOnly:true,canCloseWb:false,canCloseOzon:false,
    wbReasons:[...wb,...both],
    ozonReasons:[...ozon,...both],
    conclusion:'Ни один канал пока нельзя назвать подтверждённой чистой прибылью: сверка первички, выплат и налогов не предоставлена.'
  };
}
