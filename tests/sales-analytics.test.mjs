import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptOzon,adaptWb,adaptYandex,compareAmounts,previousClosedMonth,attachWbSku,rankSalesRows,volumeAbc,ozonDailyUnits} from '../web/office/sales-analytics-core.mjs';
const month='2026-10',target='ce9dd331-929d-4c3e-9073-368de3346bc9';
const oz={target,configuration:{month:{month}},result:{report:{periodVerified:true,quantityVerified:true,salesKopecks:100000},skuRows:[{sku:'x',soldUnits:4,returnedUnits:1}]}};
const wb={code:'wb_month_settlement',month,readOnly:true,changedRecords:0,source:'WB_FINANCE_API_D1',reportPeriodCovered:true,settlementReconciled:true,productPayoutKopecks:50000};
const ya={code:'yandex_month_evidence_available',month,readOnly:true,sourceKind:'owner_browser_audited_summary',evidence:{ownerEntity:'ИП Жилина Ольга',orderAfterServiceKopecks:30000,issues:[],skus:[{partnerId:149082506,shopSku:'sad',deliveredUnits:7,returnedUnits:1},{partnerId:149106500,shopSku:'other',deliveredUnits:99,returnedUnits:0}]}};
test('source metrics remain distinct and missing values never become zero',()=>{
 const a=adaptOzon(month,oz),b=adaptWb(month,wb),c=adaptYandex(month,ya);
 assert.equal(a.amount,100000);assert.equal(a.sold,4);assert.equal(a.returned,1);
 assert.equal(b.amount,50000);assert.equal(b.sold,null);assert.equal(c.amount,null);assert.equal(c.sold,7);assert.equal(c.rows.length,1);
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

test('SKU rankings and scope are conservative',()=>{const a=adaptWb(month,wb);const d={code:'wb_sales_sku',month,readOnly:true,changedRecords:0,coverageComplete:true,rows:[{sku:'a',sold:2,returned:0},{sku:'b',sold:8,returned:1}]};assert.equal(attachWbSku(month,a,d).sold,10);assert.equal(rankSalesRows(attachWbSku(month,a,d).rows)[0].sku,'b');assert.equal(attachWbSku(month,a,{...d,coverageComplete:false}).sold,null);assert.equal(adaptYandex(month,{...ya,evidence:{...ya.evidence,issues:[{partnerId:149082506,reason:'source_missing'}]}}).sold,null);});

test('volume ABC uses units and handles zero',()=>{assert.deepEqual(volumeAbc([{sku:'a',sold:80},{sku:'b',sold:15},{sku:'c',sold:5}]).map(x=>x.group),['A','B','C']);assert.deepEqual(volumeAbc([{sku:'a',sold:0}]),[]);});
test('daily Ozon reconciles verified SKU totals and rejects duplicate candidates',()=>{const d=structuredClone(oz);d.configuration.month.rows=[{row:1,date:'2026-10-02',service:'Выручка',quantity:4},{row:2,date:'2026-10-03',service:'Возврат выручки',quantity:1}];d.result.duplicateCandidates=[];const x=ozonDailyUnits(month,d);assert.equal(x.length,31);assert.equal(x[1].sold,4);assert.equal(x[2].returned,1);d.result.duplicateCandidates=[{}];assert.equal(ozonDailyUnits(month,d),null);d.result.duplicateCandidates=[];d.configuration.month.rows[0].quantity=3;assert.equal(ozonDailyUnits(month,d),null);});
