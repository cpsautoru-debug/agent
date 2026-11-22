// Read-only review of AGGREGATED Ozon Profit SKU rows. It does not claim
// transaction-date cost matching or physical condition of returned goods.
const count=v=>Number.isSafeInteger(v)&&v>=0;
export function reviewOzonSkuCostEvidence(rows){
  if(!Array.isArray(rows)||rows.length>5000)throw Error('invalid_ozon_sku_rows');
  const seen=new Set();let sold=0,returned=0,returnsNeedingReview=0;
  const items=rows.map(row=>{
    if(typeof row?.sku!=='string'||!row.sku.trim()||row.sku.length>150||
      seen.has(row.sku)||!count(row.soldUnits)||!count(row.returnedUnits)||
      !(row.costStatus===null||typeof row.costStatus==='string')||
      !(row.reason===null||row.reason===undefined||typeof row.reason==='string'))
      throw Error('invalid_ozon_sku_row');
    seen.add(row.sku);
    sold+=row.soldUnits;returned+=row.returnedUnits;
    if(!Number.isSafeInteger(sold)||!Number.isSafeInteger(returned))
      throw Error('ozon_sku_quantity_overflow');
    const hasReturn=row.returnedUnits>0;
    if(hasReturn)returnsNeedingReview+=row.returnedUnits;
    const costKnown=row.costStatus==='confirmed';
    return {
      sku:row.sku,returnedUnits:row.returnedUnits,
      reviewLabel:hasReturn?
        'Нужна сверка исходной себестоимости и состояния возврата':
        'Возвратов по строке нет',
      costEvidence:costKnown?'Заявлен подтверждённый статус':
        'Себестоимость не подтверждена этим статусом',
      transactionDatesVerified:false,returnConditionVerified:false,
      readyForFinalProfit:false
    };
  });
  return {
    code:'ozon_aggregate_sku_cost_review',readOnly:true,
    changedRecords:0,rows:items,soldUnits:sold,returnedUnits:returned,
    returnsNeedingReview,transactionDateCostVerified:false,
    returnRecoveryVerified:false,finalProfitVerified:false
  };
}
