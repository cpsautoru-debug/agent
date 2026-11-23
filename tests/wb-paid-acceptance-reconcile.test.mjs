import test from 'node:test';
import assert from 'node:assert/strict';
import {payoutFromRows} from '../workers/wb-finance-sync-core.mjs';

const row=(sellerOperName,values={})=>({
  sellerOperName,forPayKop:0,deliveryServiceKop:0,
  paidStorageKop:0,deductionKop:0,penaltyKop:0,
  additionalPaymentKop:0,paidAcceptanceKop:0,...values
});

test('WB fee for paid acceptance is deducted from payout exactly once',()=>{
  assert.equal(payoutFromRows([
    row('Продажа',{forPayKop:20000}),
    row('Услуга по обработке Товара',{paidAcceptanceKop:12000})
  ]),8000);
});

test('verified WB report 897706522 reconciles when paid acceptance included',()=>{
  const rows=[
    row('Продажа',{forPayKop:18453212}),
    row('Возврат',{forPayKop:1691859}),
    row('Доставка',{deliveryServiceKop:2274830}),
    row('Хранение',{paidStorageKop:29018}),
    row('Штраф',{penaltyKop:127375}),
    row('Удержание',{deductionKop:1000300}),
    row('Услуга по обработке Товара',{paidAcceptanceKop:12000})
  ];
  assert.equal(payoutFromRows(rows),13317830);
});

test('zero acceptance leaves existing reconciled payouts unchanged',()=>{
  assert.equal(payoutFromRows([row('Продажа',{forPayKop:300000}),
    row('Доставка',{deliveryServiceKop:10000})]),290000);
});
