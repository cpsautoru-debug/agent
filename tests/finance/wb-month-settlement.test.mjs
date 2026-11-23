import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateWbMonthSettlement} from '../../web/office/wb-month-settlement-core.mjs';
import {createWbMonthSettlement} from '../../functions/api/wb/month-settlement.js';
const month='2026-10';
const reports=[
 {report_id:'1',report_type:1,date_from:'2026-10-01',date_to:'2026-10-31',
  status:'complete',row_count:100,observed_rows:100,
  bank_payment_kop:68571564,api_calculated_payment_kop:68571564,
  sale_kop:90221081,return_kop:4885753,other_payout_kop:0,
  delivery_kop:7324344,storage_kop:106738,deduction_kop:7906700,
  penalty_kop:1425982,additional_kop:0,acceptance_kop:0},
 {report_id:'2',report_type:2,date_from:'2026-10-01',date_to:'2026-10-31',
  status:'complete',row_count:4,observed_rows:4,
  bank_payment_kop:0,api_calculated_payment_kop:0,sale_kop:0,
  return_kop:0,other_payout_kop:0,delivery_kop:0,storage_kop:0,
  deduction_kop:0,penalty_kop:0,additional_kop:0,acceptance_kop:0}
];
const costs={sold_articles:35,confirmed_articles:0,preliminary_articles:1};
test('WB October report settlements reconcile but never become manufactured profit',()=>{
 const r=calculateWbMonthSettlement(month,reports,costs);
 assert.equal(r.afterWbChargesKopecks,68571564);
 assert.equal(r.productPayoutKopecks,90221081);
 assert.equal(r.returnsKopecks,4885753);
 assert.equal(r.platformFeesKopecks,16763764);
 assert.equal(r.soldArticles,35);
 assert.equal(r.confirmedCostArticles,0);
 assert.equal(r.reportPeriodCovered,true);
 assert.equal(r.settlementReconciled,true);
 assert.equal(r.manufacturingCostKopecks,null);
 assert.equal(r.contributionKopecks,null);
 assert.equal(r.netProfitKopecks,null);
 assert.equal(r.profitVerified,false);
});
test('incomplete types or mismatched reports cannot become a verified settlement',()=>{
 const r=calculateWbMonthSettlement(month,reports.slice(0,1),costs);
 assert.equal(r.reportPeriodCovered,false);
 assert.equal(r.afterWbChargesKopecks,null);
 assert.throws(()=>calculateWbMonthSettlement(month,
  [{...reports[0],bank_payment_kop:68571565},reports[1]],costs),
  /wb_month_payment_mismatch/);
 assert.throws(()=>calculateWbMonthSettlement(month,
  [{...reports[0],observed_rows:99},reports[1]],costs),
  /wb_month_report_invalid/);
});
test('unclassified payouts are not silently ignored',()=>{
 const x={...reports[0],other_payout_kop:100};
 assert.throws(()=>calculateWbMonthSettlement(month,[x,reports[1]],costs),
  /wb_month_unclassified_finance/);
});
test('WB endpoint rejects unauthenticated or unclosed periods without querying data',async()=>{
 const handler=createWbMonthSettlement({now:()=>Date.UTC(2026,10,24)});
 const url='https://example.com/api/wb/month-settlement?month=2026-10';
 assert.equal((await handler({request:new Request(url,{method:'POST'}),env:{}})).status,405);
 assert.equal((await handler({request:new Request(url.replace('2026-10','2026-11')),env:{}})).status,400);
 assert.equal((await handler({request:new Request(url),env:{}})).status,503);
});
