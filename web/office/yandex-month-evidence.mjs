// Yandex's official order report has a separate order-level margin sheet.
// incomeWithoutServices already deducts the order-related Yandex services.
// The independent service and payment reports are cross-check evidence,
// not extra revenue and NOT automatically an extra expense.
const expected={orders:'services_and_orders_margin.json',
 services:null,payments:'transaction_date.json'};
function amount(sheet,field){
 const x=sheet?.sumFields?.[field];
 return x&&Number.isSafeInteger(x.totalKopecks)?
  {kopecks:x.totalKopecks,rows:x.present||0,
   invalid:x.invalid||0,source:sheet.sheet}:null;
}
export function buildYandexMonthlyEvidence(sources){
 const missing=['orders','services','payments'].filter(t=>
  sources?.[t]?.code!=='yandex_report_archive_audited'||
  !Array.isArray(sources[t].sheets));
 const result={status:'incomplete',verifiedProfitKopecks:null,
  preliminaryOrderAfterServiceKopecks:null,financialResultKopecks:null,
  missing,blocks:[],orderMargin:null,services:null,payments:null,
  meaning:'Source-accounting indicators, never final net profit.'};
 if(missing.length){
  result.blocks.push('three_official_reports_required');
  return result;
 }
 const orderSheet=sources.orders.sheets.find(s=>s.sheet===expected.orders);
 if(!orderSheet||!Number.isSafeInteger(orderSheet.rows)){
  result.blocks.push('canonical_orders_margin_sheet_missing');
 }else{
  const income=amount(orderSheet,'incomeWithoutServices');
  const commission=amount(orderSheet,'summaryCommission');
  const saleValue=amount(orderSheet,'sumBillingPriceOfItems');
  const duplicates=Number.isSafeInteger(orderSheet.duplicateOrderIds)?
   orderSheet.duplicateOrderIds:null;
  const orderIds=Number.isSafeInteger(orderSheet.ordersWithIds)?
   orderSheet.ordersWithIds:null;
  const ready=!!income&&income.rows===orderSheet.rows&&
   income.invalid===0&&duplicates===0&&
   orderIds===orderSheet.rows&&orderSheet.rows>0;
  result.orderMargin={
   rows:orderSheet.rows,income,commission,saleValue,duplicates,
   orderIds,coverageConfirmed:ready,
   note:'incomeWithoutServices includes Yandex order-service deduction'};
  if(ready)result.preliminaryOrderAfterServiceKopecks=income.kopecks;
  else result.blocks.push('orders_margin_completeness_not_verified');
 }
 const sheetServices=sources.services.sheets;
 const serviceRows=sheetServices.reduce((a,s)=>a+(s.rows||0),0);
 const serviceTotals=sheetServices.filter(s=>s.rows>0).map(s=>({
  name:s.sheet,rows:s.rows,amount:amount(s,'servicePrice')
 }));
 result.services={rows:serviceRows,sheets:serviceTotals,
  note:'Do not subtract a service that is included in summaryCommission again.'};
 if(serviceTotals.some(s=>!s.amount||s.amount.rows!==s.rows||
    s.amount.invalid>0))result.blocks.push('service_amount_coverage_incomplete');
 const paymentSheet=sources.payments.sheets.find(s=>
  s.sheet===expected.payments);
 const payments=paymentSheet?amount(paymentSheet,'transactionSum'):null;
 result.payments={rows:paymentSheet?.rows??null,amount:payments,
  note:'Payment transaction sum is not sales revenue or net profit'};
 if(!paymentSheet||!payments||payments.rows!==paymentSheet.rows||
    payments.invalid>0)result.blocks.push('payment_coverage_incomplete');
 result.blocks.push('sales_returns_and_sku_cogs_not_reconciled');
 result.blocks.push('separate_service_charges_and_external_costs_not_reconciled');
 result.blocks.push('ip_ausn_tax_and_bank_not_reconciled');
 result.status='source_evidence_ready';
 return result;
}
