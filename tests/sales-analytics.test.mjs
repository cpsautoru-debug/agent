import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptOzon,adaptWb,adaptYandex,compareAmounts,previousClosedMonth} from '../web/office/sales-analytics-core.mjs';
const month='2026-10',target='ce9dd331-929d-4c3e-9073-368de3346bc9';
const oz={target,configuration:{month:{month}},result:{report:{periodVerified:true,quantityVerified:true,salesKopecks:100000},skuRows:[{sku:'x',soldUnits:4,returnedUnits:1}]}};
const wb={code:'wb_month_settlement',month,readOnly:true,changedRecords:0,source:'WB_FINANCE_API_D1',reportPeriodCovered:true,settlementReconciled:true,productPayoutKopecks:50000};
const ya={code:'yandex_month_evidence_available',month,readOnly:true,sourceKind:'owner_browser_audited_summary',evidence:{ownerEntity:'ИП Жилина Ольга',orderAfterServiceKopecks:30000}};
test('source metrics remain distinct and missing values never become zero',()=>{
 const a=adaptOzon(month,oz),b=adaptWb(month,wb),c=adaptYandex(month,ya);
 assert.equal(a.amount,100000);assert.equal(a.sold,4);assert.equal(a.returned,1);
 assert.equal(b.amount,50000);assert.equal(b.sold,null);assert.equal(c.amount,30000);
 assert.equal(compareAmounts(a,b),null);assert.equal(compareAmounts(b,c),null);
 for(const adapt of [adaptOzon,adaptWb,adaptYandex])assert.equal(adapt(month,null).amount,null);
 assert.equal(adaptOzon('2026-09',oz).amount,null);
 assert.equal(adaptWb(month,{...wb,reportPeriodCovered:false}).amount,null);
 assert.equal(adaptYandex(month,{...ya,code:'yandex_month_evidence_stale'}).amount,null);
});
test('month change uses same metric and zero denominator stays unknown',()=>{
 const a=adaptOzon(month,oz);
 assert.deepEqual(compareAmounts(a,{...a,amount:80000}),{delta:20000,bps:2500});
 assert.deepEqual(compareAmounts(a,{...a,amount:0}),{delta:100000,bps:null});
 assert.equal(compareAmounts(a,{...a,amount:null}),null);
 assert.equal(previousClosedMonth('2026-01'),'2025-12');
});
