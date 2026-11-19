import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWbWorkerProfit1044 } from '../../workers/wb-worker-profit-1044.mjs';

function input() {
  return {
    reportId: '10293',
    expectedPayoutRub: '278.00',
    preflight: {
      status: 'XLSX_LOCAL_PREFLIGHT_UNVERIFIED', dataVerified: false,
      sourceRows: 8, sales: 3, returns: 1, skuCount: 2,
      payoutRub: '278.00', assumedTaxBaseRub: '300.00', assumedAusn8Rub: '24.00',
      counts: [{sku: 'A', sales: 2, returns: 1}, {sku: 'B', sales: 1, returns: 0}]
    },
    catalog: { reportId: '10293', items: [
      {vendorCode: 'A', unitCostRub: '25.50', status: 'CONFIRMED_BY_USER'},
      {vendorCode: 'B', unitCostRub: '8.00', status: 'ASSUMED_UNCONFIRMED'}
    ] }
  };
}

test('joins sales and return by SKU, tax 8%, no double deductions', () => {
  const r = buildWbWorkerProfit1044(input());
  assert.equal(r.estimate.payoutKop, 27800);
  assert.equal(r.estimate.cogsKop, 5900);
  assert.equal(r.estimate.returnedCogsKop, 2550);
  assert.equal(r.estimate.taxKop, 2400);
  assert.equal(r.estimate.profitWithoutRestorationKop, 19500);
  assert.equal(r.estimate.profitWithRestorationKop, 22050);
});
test('never claims verified profit or tax', () => {
  const r = buildWbWorkerProfit1044(input());
  assert.equal(r.dataVerified, false);
  assert.equal(r.profitStatus, 'UNVERIFIED');
  assert.equal(r.estimate.profitStatus, 'UNVERIFIED');
  assert.match(r.taxBasisStatus, /NOT_FNS_VERIFIED/);
});
test('cost status counted only for sold units', () => {
  const r = buildWbWorkerProfit1044(input());
  assert.deepEqual(r.cogsQuality.CONFIRMED_BY_USER, {units:2, costKop:5100});
  assert.deepEqual(r.cogsQuality.ASSUMED_UNCONFIRMED, {units:1, costKop:800});
});
test('rejects incorrect manual payout', () => {
  const i = input(); i.expectedPayoutRub = '277.99';
  assert.throws(() => buildWbWorkerProfit1044(i), /payout_does_not_match_manual_target/);
});
test('rejects tax mismatch', () => {
  const i = input(); i.preflight.assumedAusn8Rub = '24.01';
  assert.throws(() => buildWbWorkerProfit1044(i), /preflight_tax_mismatch/);
});
test('rejects missing SKU from catalog', () => {
  const i = input(); i.catalog.items[1].vendorCode = 'C';
  assert.throws(() => buildWbWorkerProfit1044(i), /missing_cost_sku/);
});
test('rejects duplicate SKU and unknown status', () => {
  const i = input(); i.catalog.items[1].vendorCode = 'A';
  assert.throws(() => buildWbWorkerProfit1044(i), /invalid_or_duplicate_cost_sku/);
  const j = input(); j.catalog.items[0].status = 'VERIFIED';
  assert.throws(() => buildWbWorkerProfit1044(j), /invalid_or_duplicate_cost_sku/);
});
test('rejects mismatch in report IDs', () => {
  const i = input(); i.reportId = '900';
  assert.throws(() => buildWbWorkerProfit1044(i), /cost_catalog_report_mismatch/);
});
test('rejects altered sale/return quantities', () => {
  const i = input(); i.preflight.counts[0].sales = 3;
  assert.throws(() => buildWbWorkerProfit1044(i), /sku_count_mismatch/);
});
test('rejects unexpected fields in confidential catalog', () => {
  const i = input(); i.catalog.items[0].marketingExpenseRub = '100';
  assert.throws(() => buildWbWorkerProfit1044(i), /unexpected_fields/);
});
test('integer kopecks, not floating point input', () => {
  const i = input(); i.catalog.items[0].unitCostRub = '1.005';
  assert.throws(() => buildWbWorkerProfit1044(i), /invalid_rub_amount/);
});
test('rejects an unverifiable return that exceeds sale costs', () => {
  const i = input(); i.preflight.counts[0] = {sku:'A', sales:0, returns:1};
  i.preflight.counts[1] = {sku:'B', sales:1, returns:0};
  i.preflight.sales = 1; i.catalog.items[0].unitCostRub='500.00';
  assert.throws(() => buildWbWorkerProfit1044(i), /invalid_return_cost/);
});
