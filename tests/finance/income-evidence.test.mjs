import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeIncomeEvidence,createEntityIncomeEvidence} from
 '../../functions/api/finance/income-evidence.js';
const month='2026-10';
const finance={target:'ce9dd331-929d-4c3e-9073-368de3346bc9',
 configuration:{month:{month,periodVerified:true,rows:[
  {service:'Выручка',amountKopecks:12000},
  {service:'Возврат выручки',amountKopecks:-2000},
  {service:'Баллы за скидки',amountKopecks:1800},
  {service:'Программы партнёров',amountKopecks:120},
  {service:'Оплата за клик',amountKopecks:-100}
 ]}}};
const wb={operations:[
 {seller_oper_name:'Продажа',rows:4,for_pay_kop:5000},
 {seller_oper_name:'Возврат',rows:1,for_pay_kop:1200}
],reports:[{date_from:'2026-10-01',date_to:'2026-10-31',
 report_type:1,status:'complete',row_count:5}]};
test('income evidence identifies source figures without calling payouts tax revenue',()=>{
 const result=summarizeIncomeEvidence(month,finance,wb);
 assert.equal(result.ozon.serviceAmounts['Выручка'].amountKopecks,12000);
 assert.equal(result.ozon.serviceAmounts['Баллы за скидки'].amountKopecks,1800);
 assert.equal(result.wb.operationAmounts['Продажа'].forPayKopecks,5000);
 assert.equal(result.ozon.taxIncomeConfirmed,false);
 assert.equal(result.ozon.taxDocumentPresent,false);
 assert.equal(result.wb.reportPeriodComplete,true);
 assert.deepEqual(result.wb.reportTypeCoverage[0].missingDates,[]);
 assert.equal(result.ozon.nonAdditiveTotals,true);
 assert.equal(result.ozon.classification.discountPoints.status,
   'marketplace_bonus_not_separate_sales_revenue');
 assert.equal(result.ozon.classification.customerRevenue.status,
   'accrual_not_cash_basis');
 assert.equal(result.wb.taxIncomeConfirmed,false);
 assert.equal(result.distributionReady,false);
 assert.equal(result.fnsRegisterReconciled,false);
 assert.deepEqual(result.unknownChannels,['yandex','avito','offline']);
});
test('incomplete and unsafe sources are rejected',()=>{
 assert.throws(()=>summarizeIncomeEvidence(month,{
  ...finance,configuration:{month:{...finance.configuration.month,periodVerified:false}}
 },wb),/income_sources_incomplete/);
 assert.throws(()=>summarizeIncomeEvidence(month,finance,{
  ...wb,operations:[wb.operations[0],wb.operations[0]]
 }),/duplicate_wb_operation/);
 assert.throws(()=>summarizeIncomeEvidence(month,finance,{
  ...wb,reports:[{...wb.reports[0],status:'error'}]
 }),/invalid_wb_coverage/);
});
test('endpoint is restricted to closed months and owner session',async()=>{
 const handler=createEntityIncomeEvidence({now:()=>Date.UTC(2026,10,23)});
 const base='https://office.example/api/finance/income-evidence?month=2026-10';
 assert.equal((await handler({request:new Request(base,{method:'POST'}),env:{}})).status,405);
 assert.equal((await handler({request:new Request(base.replace('2026-10','2026-11')),env:{}})).status,400);
 assert.equal((await handler({request:new Request(base),env:{}})).status,503);
});

test('WB report coverage distinguishes missing periods from complete rows',()=>{
 const partial={...wb,reports:[
  {...wb.reports[0],date_to:'2026-10-15'}]};
 const result=summarizeIncomeEvidence(month,finance,partial);
 assert.equal(result.wb.reportPeriodComplete,false);
 assert.equal(result.wb.reportTypeCoverage[0].missingDates.length,16);
 assert.equal(result.distributionReady,false);
});
test('overlapping intervals cannot masquerade as full coverage',()=>{
 const duplicatePeriods={...wb,reports:[
  {...wb.reports[0],date_from:'2026-10-01',date_to:'2026-10-15',row_count:3},
  {...wb.reports[0],date_from:'2026-10-15',date_to:'2026-10-31',row_count:2}
 ]};
 const result=summarizeIncomeEvidence(month,finance,duplicatePeriods);
 assert.equal(result.wb.reportTypeCoverage[0].overlappingDays,1);
 assert.equal(result.wb.reportPeriodComplete,false);
});

test('WB cost readiness identifies missing confirmed costs without claiming sale-date match',()=>{
 const x=summarizeIncomeEvidence(month,finance,{
  ...wb,costCoverage:{sold_articles:35,confirmed_articles:0,preliminary_articles:1}
 });
 assert.deepEqual(x.wb.costCoverage,{
  soldArticles:35,confirmedArticles:0,preliminaryArticles:1,
  matchingGranularity:'REPORT_PERIOD_NOT_SALE_DATE',complete:false
 });
 assert.equal(x.distributionReady,false);
});
test('WB cost coverage rejects more confirmed than sold articles',()=>{
 assert.throws(()=>summarizeIncomeEvidence(month,finance,{
  ...wb,costCoverage:{sold_articles:35,confirmed_articles:36,preliminary_articles:1}
 }),/invalid_wb_cost_coverage/);
});
