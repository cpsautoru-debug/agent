import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exactFinanceJson, moneyKop, normalizeReport,
  normalizeOperation, payoutFromRows
} from '../../workers/wb-finance-sync-core.mjs';

test('money normalization preserves ruble and kopeck precision, including negative logistics', () => {
  assert.equal(moneyKop('79226.33'), 7922633);
  assert.equal(moneyKop('-172.25'), -17225);
  assert.throws(() => moneyKop('4.001'), /invalid_money/);
  assert.throws(() => moneyKop(undefined), /invalid_money/);
});

test('report IDs and pagination IDs survive integers larger than 2^53', () => {
  const rows = exactFinanceJson('[{"reportId":92233720368547758,"rrdId":92233720368547759}]');
  assert.equal(rows[0].reportId, '92233720368547758');
  assert.equal(rows[0].rrdId, '92233720368547759');
});

test('main and buyout reports retain bank payments and can be negative', () => {
  const data = normalizeReport({
    reportId: 874345690, dateFrom:'2026-10-05',dateTo:'2026-10-11',
    reportType:2,currency:'RUB',bankPaymentSum:'-172.25'
  });
  assert.equal(data.bankPaymentKop,-17225);
  assert.equal(data.reportType,2);
});

test('zero-sales report contains delivery charges, not invented sales or COGS', () => {
  const row=normalizeOperation({
    reportId:'874345690',rrdId:'13',sellerOperName:'Логистика',
    currency:'RUB',quantity:0,forPay:'0',deliveryService:'172.25',
    paidStorage:'0',deduction:'0',penalty:'0'
  },'874345690');
  assert.equal(row.vendorCode,null);
  assert.equal(row.forPayKop,0);
  assert.equal(payoutFromRows([row]),-17225);
});

test('sold articles need a real vendor code and no fake zero cost', () => {
  assert.throws(() => normalizeOperation({
    reportId:'865265818',rrdId:'1',sellerOperName:'Продажа',
    currency:'RUB',quantity:1,forPay:'100'
  },'865265818'),/sale_missing_product/);
});

test('first report settlement components match previous verified diagnostic formula', () => {
  const r1=normalizeOperation({
    reportId:'865265818',rrdId:'1',sellerOperName:'Продажа',
    vendorCode:'веста №6',currency:'RUB',quantity:1,
    forPay:'79326.33',deliveryService:'100.00',
    paidStorage:'0',deduction:'0',penalty:'0'
  },'865265818');
  assert.equal(payoutFromRows([r1]),7922633);
});
