import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzonFinanceReadiness,summarizeOzonFinanceReadiness}
  from './finance-readiness.js';
const base={period:'2026-10',processed_days:31,records_count:947,
 posting_kopecks:184014311,item_kopecks:-3408258,
 non_item_kopecks:-47114907,control_total_kopecks:133491146,
 complete:1,reconciled:0,final:0};
const accrual={rows_checked:2144,observed_days:29,
 first_day:'2026-10-01',last_day:'2026-10-29',
 accrual_total_kopecks:130288595,sold_skus:35,covered_sold_skus:3};
test('October source audit refuses to claim financial closeout',()=>{
 const a=summarizeOzonFinanceReadiness('2026-10',base,accrual,{n:3});
 assert.deepEqual(a.blockers,[
   'report_not_reconciled','report_not_final','accrual_sync_coverage_unverified',
   'costs_missing_for_sold_skus','date_effective_costs_missing'
 ]);
 assert.equal(a.accruals.observedDays,29);
 assert.equal(a.cogs.confirmedSoldSkus,3);
 assert.equal(a.cogs.dateEffectiveCostEntries,0);
 assert.equal(a.report.controlTotalKop,133491146);
 assert.equal(a.netProfitVerified,false);
 assert.equal(a.changedRecords,0);
});
test('zero rows never constitutes complete COGS',()=>{
 const a=summarizeOzonFinanceReadiness('2026-10',null,{
   ...accrual,rows_checked:0,observed_days:0,sold_skus:0,
   covered_sold_skus:0,accrual_total_kopecks:0},{n:0});
 assert.ok(a.blockers.includes('report_missing'));
 assert.ok(a.blockers.includes('costs_missing_for_sold_skus'));
});
test('inconsistent financial report totals must fail closed',()=>{
 assert.throws(()=>summarizeOzonFinanceReadiness('2026-10',
   {...base,control_total_kopecks:1},accrual,{n:3}),
 /invalid_finance_audit_source/);
});
test('new endpoint rejects writes and invalid time windows before DB access',async()=>{
 const handler=createOzonFinanceReadiness();
 for(const req of [
   new Request('https://example.com/api/ozon/finance-readiness?month=2026-10',{method:'POST'}),
   new Request('https://example.com/api/ozon/finance-readiness?month=2026-13'),
   new Request('https://example.com/api/ozon/finance-readiness?month=2026-12')
 ]){
   const response=await handler({request:req,env:{}});
   assert.ok([400,405].includes(response.status));
 }
});
test('endpoint does not leak data when owner session missing',async()=>{
 const handler=createOzonFinanceReadiness();
 const res=await handler({request:new Request(
   'https://example.com/api/ozon/finance-readiness?month=2026-10'),env:{}});
 assert.equal(res.status,503);
});
