import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateWbSkuBreakdown} from '../../web/office/wb-unit-economics-core.mjs';
const group={
  report_id:'1001',vendor_code:'TEST',date_from:'2026-10-01',
  date_to:'2026-10-07',status:'complete',operation_count:1,
  sold_units:1,returned_units:0,product_payout_kop:50000,
  platform_fees_kop:5000,additional_payment_kop:0,paid_acceptance_kop:0
};
const stats={complete_reports:1,pending_reports:0,mismatched_reports:1,
  bank_payout_kop:45000,completed_operations:1};
test('WB mismatch is visible but excluded from matched complete-report subtotal',()=>{
  const result=calculateWbSkuBreakdown([group],[],stats);
  assert.equal(result.reconciliation,'matched');
  assert.equal(result.mismatchedReports,1);
  assert.equal(result.bankPayoutKopecks,45000);
  assert.ok(result.blockers.includes('report_reconciliation_mismatch'));
  assert.equal(result.netProfitKopecks,null);
});
test('report status count rejects malformed records',()=>{
  assert.throws(()=>calculateWbSkuBreakdown([group],[],{
    ...stats,mismatched_reports:-1}),/wb_profit_input_invalid/);
});
test('WB source query explicitly counts mismatch and excludes it from completed payout',()=>{
  const api=readFileSync(new URL('../../functions/api/wb/unit-economics.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/wb-unit-economics.js',import.meta.url),'utf8');
  assert.match(api,/status='mismatch'.+AS mismatched_reports/);
  assert.match(api,/status='complete'.+AS bank_payout_kop/);
  assert.match(ui,/data\.mismatchedReports/);
  assert.match(ui,/НЕ включены в подтверждённую сумму/);
});
