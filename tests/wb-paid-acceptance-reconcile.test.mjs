import test from 'node:test';
import assert from 'node:assert/strict';
import {payoutFromRows} from '../workers/wb-finance-sync-core.mjs';
import {reconcileStoredAcceptanceMismatch} from '../workers/wb-finance-auto-sync.js';

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

function mockDb({difference=12000,acceptance=12000,rowCount=246}={}){
  const events=[];
  const db={prepare(sql){return{bind(...args){events.push({sql,args});
    return {
      async first(){
        if(sql.includes('FROM wb_finance_api_reports'))return {
          report_id:'897706522',bank_payment_kop:13317830,
          api_calculated_payment_kop:13317830+difference,row_count:246
        };
        if(sql.includes('FROM wb_finance_api_rows'))return{
          n:rowCount,acceptance,corrected:13317830
        };
        throw Error('unexpected read');
      },
      async run(){return {meta:{changes:1}};}
    };
  }}}};
  return {db,events};
}
test('exact stored WB acceptance discrepancy can be repaired once',async()=>{
  const {db,events}=mockDb();
  assert.equal(await reconcileStoredAcceptanceMismatch(db),true);
  const writes=events.filter(x=>x.sql.startsWith('UPDATE '));
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].args.slice(0,3),
    [13317830,'4271851','897706522']);
});
test('WB auto-reconciliation fails closed when fee is not exact difference',async()=>{
  const {db,events}=mockDb({acceptance:11999});
  assert.equal(await reconcileStoredAcceptanceMismatch(db),false);
  assert.equal(events.some(x=>x.sql.startsWith('UPDATE ')),false);
});
test('WB auto-reconciliation fails closed if source row count changed',async()=>{
  const {db,events}=mockDb({rowCount:245});
  assert.equal(await reconcileStoredAcceptanceMismatch(db),false);
  assert.equal(events.some(x=>x.sql.startsWith('UPDATE ')),false);
});
