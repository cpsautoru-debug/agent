import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewOzonSkuCostEvidence} from '../../web/office/ozon-sku-cost-evidence.mjs';
test('returned goods require separate cost and condition review even when SKU cost is confirmed',()=>{
 const result=reviewOzonSkuCostEvidence([
   {sku:'VESTA-1',soldUnits:5,returnedUnits:2,costStatus:'confirmed',reason:null},
   {sku:'PRIORA',soldUnits:3,returnedUnits:0,costStatus:'preliminary',reason:'cost_preliminary'}
 ]);
 assert.equal(result.soldUnits,8);
 assert.equal(result.returnedUnits,2);
 assert.equal(result.returnsNeedingReview,2);
 assert.match(result.rows[0].reviewLabel,/Нужна сверка/);
 assert.equal(result.rows[0].returnConditionVerified,false);
 assert.equal(result.transactionDateCostVerified,false);
 assert.equal(result.returnRecoveryVerified,false);
 assert.equal(result.finalProfitVerified,false);
 assert.equal(result.changedRecords,0);
});
test('reject duplicate SKUs, invalid quantities and malformed rows',()=>{
 for(const invalid of [
   [{sku:'',soldUnits:2,returnedUnits:0}],
   [{sku:'A',soldUnits:-1,returnedUnits:0}],
   [{sku:'A',soldUnits:1,returnedUnits:0},{sku:'A',soldUnits:1,returnedUnits:0}],
   [{sku:'A',soldUnits:1.25,returnedUnits:0}]
 ])assert.throws(()=>reviewOzonSkuCostEvidence(invalid),/invalid/);
});
test('Profit rendering shows return review without changing monetary calculations',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/profit.js',import.meta.url),'utf8');
 assert.match(html,/id="profitSkuEvidence"/);
 assert.match(html,/Контроль возврата/);
 assert.match(html,/ozon-sku-cost-evidence\.mjs\?v=20261122/);
 assert.match(js,/reviewOzonSkuCostEvidence/);
 assert.match(js,/transactionDateCostVerified|Нужна сверка|не доказывает соответствие цены дате/);
 assert.match(js,/netEstimateKopecks/);
});
