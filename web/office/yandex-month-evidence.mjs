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
 const serviceTotals=sheetServices.filter(s=>s.rows>0).map(s=>{
  // Exact official JSON report schema: placement.json has totalAmount,
  // other service sheets have servicePrice. No inferred amount/zero.
  const amountField=s.sheet==='placement.json'?'totalAmount':'servicePrice';
  const reported=amount(s,amountField);
  const serviceColumn=s.sumFields?.[amountField];
  // Source diagnostic: distinguish missing per-row values from invalid
  // numbers without guessing zeros or subtracting charges twice.
  const priceRows=Number.isSafeInteger(serviceColumn?.present)?
   serviceColumn.present:0;
  const invalid=Number.isSafeInteger(serviceColumn?.invalid)?
   serviceColumn.invalid:0;
  const candidates=['totalAmount','servicePrice','buyerPaymentAmount',
   'billingPrice','transactionSum','paymentAmount'].filter(field=>
    Number.isSafeInteger(s.sumFields?.[field]?.present)&&
    s.sumFields[field].present>0).map(field=>({
     field,present:s.sumFields[field].present,
     invalid:s.sumFields[field].invalid}));
  return {name:s.sheet,rows:s.rows,amountField,amount:reported,
   uncoveredRows:s.rows-priceRows-invalid,
   invalidRows:invalid,candidates};
 });
 const serviceMissing=serviceTotals.filter(s=>
  !s.amount||s.amount.rows!==s.rows||s.amount.invalid>0);
 result.services={rows:serviceRows,sheets:serviceTotals,
  incompleteSheets:serviceMissing.map(s=>s.name),
  note:'Use totalAmount for placement.json, servicePrice for other sheets. Missing is NOT zero; order commission is not deducted twice.'};
 if(serviceMissing.length)result.blocks.push('service_amount_coverage_incomplete');
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
