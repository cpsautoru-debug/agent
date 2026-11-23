// Pure, read-only calendar-month WB financial settlement analysis.
// Settlement after WB withholding is NOT product or net profit.
const isKop=Number.isSafeInteger;
const sum=(items)=>items.reduce((a,b)=>{
 const n=a+b;if(!isKop(n))throw Error('wb_month_sum_overflow');return n;
},0);
export function calculateWbMonthSettlement(month,reports,coverage){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||'')||
   !Array.isArray(reports)||reports.length>300||
   !coverage||!isKop(coverage.sold_articles)||
   !isKop(coverage.confirmed_articles)||
   !isKop(coverage.preliminary_articles))
   throw Error('wb_month_input_invalid');
 if(coverage.sold_articles<0||coverage.confirmed_articles<0||
   coverage.preliminary_articles<0||
   coverage.confirmed_articles>coverage.sold_articles||
   coverage.preliminary_articles>coverage.sold_articles)
   throw Error('wb_month_cost_coverage_invalid');
 const start=month+'-01',end=new Date(Date.parse(start+'T00:00:00Z'));
 end.setUTCMonth(end.getUTCMonth()+1);
 const until=end.toISOString().slice(0,10),last=new Date(end-86400000)
   .toISOString().slice(0,10);
 const seen=new Set(),daysByType=new Map();
 const fields=['sale_kop','return_kop','other_payout_kop','delivery_kop',
   'storage_kop','deduction_kop','penalty_kop',
   'additional_kop','acceptance_kop','bank_payment_kop'];
 for(const row of reports){
   if(typeof row.report_id!=='string'||!/^[0-9]{1,20}$/.test(row.report_id)||
     seen.has(row.report_id)||row.status!=='complete'||
     ![1,2].includes(row.report_type)||
     !/^\d{4}-\d{2}-\d{2}$/.test(row.date_from||'')||
     !/^\d{4}-\d{2}-\d{2}$/.test(row.date_to||'')||
     row.date_from<start||row.date_to>last||row.date_from>row.date_to||
     !isKop(row.row_count)||row.row_count<=0||
     row.observed_rows!==row.row_count||
     !isKop(row.api_calculated_payment_kop)||
     fields.some(f=>!isKop(row[f])))
     throw Error('wb_month_report_invalid');
   seen.add(row.report_id);
   if(row.other_payout_kop!==0||row.additional_kop!==0||row.acceptance_kop!==0)
     throw Error('wb_month_unclassified_finance');
   const computed=sum([row.sale_kop,-row.return_kop,-row.delivery_kop,
     -row.storage_kop,-row.deduction_kop,-row.penalty_kop]);
   if(computed!==row.bank_payment_kop||
     computed!==row.api_calculated_payment_kop)
     throw Error('wb_month_payment_mismatch');
   if(!daysByType.has(row.report_type))daysByType.set(row.report_type,new Set());
   const days=daysByType.get(row.report_type);
   for(let ms=Date.parse(row.date_from+'T00:00:00Z');
       ms<=Date.parse(row.date_to+'T00:00:00Z');ms+=86400000){
     const day=new Date(ms).toISOString().slice(0,10);
     if(days.has(day))throw Error('wb_month_duplicate_period');
     days.add(day);
   }
 }
 const expected=(end-Date.parse(start+'T00:00:00Z'))/86400000;
 const coverageComplete=reports.length>0&&
   [1,2].every(type=>daysByType.get(type)?.size===expected);
 const total=field=>sum(reports.map(r=>r[field]));
 const sale=total('sale_kop'),returns=total('return_kop');
 const fees=sum(['delivery_kop','storage_kop','deduction_kop','penalty_kop']
   .map(total));
 const settlement=total('bank_payment_kop');
 const settlementReconciled=coverageComplete&&
   settlement===sum([sale,-returns,-fees]);
 return {code:'wb_month_settlement',month,readOnly:true,changedRecords:0,
  source:'WB_FINANCE_API_D1',
  reports:reports.length,rows:total('row_count'),
  expectedDays:expected,reportPeriodCovered:coverageComplete,
  settlementReconciled,productPayoutKopecks:sale,
  returnsKopecks:returns,platformFeesKopecks:fees,
  deliveryKopecks:total('delivery_kop'),
  storageKopecks:total('storage_kop'),
  deductionsKopecks:total('deduction_kop'),
  penaltyKopecks:total('penalty_kop'),
  afterWbChargesKopecks:settlementReconciled?settlement:null,
  soldArticles:coverage.sold_articles,
  confirmedCostArticles:coverage.confirmed_articles,
  preliminaryCostArticles:coverage.preliminary_articles,
  manufacturingCostKopecks:null,contributionKopecks:null,
  netProfitKopecks:null,profitVerified:false,
  label:'Settlements under complete WB reports AFTER listed WB charges; BEFORE manufacturing costs, external advertising, business overhead and taxes.'};
}
