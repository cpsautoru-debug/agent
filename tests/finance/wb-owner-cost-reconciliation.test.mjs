import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileWbOwnerCostSnapshots}
 from '../../web/office/wb-owner-cost-reconciliation.mjs';
const month='2026-10';
const sales=Array.from({length:35},(_,i)=>({
 vendor_code:'SKU-'+(i+1),
 sold_units:i===34?3:5,
 returned_units:i===0?5:i===1?1:0
}));
const snapshots=Array.from({length:9},(_,i)=>({
 report_id:String(800000000+i),source:'USER_SUPPLIED_WB_XLSX',
 snapshot_json:JSON.stringify({
   reportId:String(800000000+i),
   periodStart:'2026-10-01',periodEnd:'2026-10-31',
   preview:{breakdown:sales.map(x=>({
     sku:x.vendor_code,unitCostKop:10000,costStatus:'CONFIRMED_BY_USER',
     sales:1,returns:0
   }))}
 })
}));
test('reconciles all 35 owner-confirmed historical WB SKU costs and 6 resale returns',()=>{
 const x=reconcileWbOwnerCostSnapshots(month,snapshots,sales);
 assert.equal(x.confirmedSkuCount,35);
 assert.equal(x.confirmedSoldUnits,173);
 assert.equal(x.resalableReturnedUnits,6);
 assert.equal(x.grossManufacturingCostKopecks,1730000);
 assert.equal(x.recoveredReturnCostKopecks,60000);
 assert.equal(x.netManufacturingCostKopecks,1670000);
 assert.equal(x.status,'management_cost_reconciled');
 assert.equal(x.readOnly,true);
 assert.equal(x.changedRecords,0);
});
test('reject different costs between saved WB reports',()=>{
 const s=structuredClone(snapshots);
 const j=JSON.parse(s[2].snapshot_json);
 j.preview.breakdown[0].unitCostKop=11000;
 s[2].snapshot_json=JSON.stringify(j);
 assert.throws(()=>reconcileWbOwnerCostSnapshots(month,s,sales),/wb_xlsx_cost_conflict/);
});
test('reject missing cost, unconfirmed cost, missing return data, incomplete snapshots',()=>{
 const cases=[
  [snapshots.slice(1),sales],
  [snapshots,sales.slice(1)],
  [snapshots,sales.map((x,i)=>i===0?{...x,returned_units:0}:x)]
 ];
 for(const [s,r] of cases)
  assert.throws(()=>reconcileWbOwnerCostSnapshots(month,s,r));
 const copy=structuredClone(snapshots);
 const j=JSON.parse(copy[0].snapshot_json);
 j.preview.breakdown[0].costStatus='REFERENCE_UNVERIFIED';
 copy[0].snapshot_json=JSON.stringify(j);
 assert.throws(()=>reconcileWbOwnerCostSnapshots(month,copy,sales),
  /wb_xlsx_cost_not_confirmed/);
});
