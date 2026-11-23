import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOctoberWbSyncPlan,onRequestPost}
 from '../../functions/api/wb/cost-sync.js';
function fixture(){
 const costLines=Array.from({length:35},(_,i)=>({
  vendorCode:i===0?'веста №2':'sku_'+i,unitCostKopecks:420000,
  soldUnits:i===34?3:5,resalableReturnedUnits:i===0?5:i===1?1:0,
  netCostKopecks:(i===34?3:i===0?0:i===1?4:5)*420000
 }));
 return {status:'management_cost_reconciled',scope:'2026-10',
  confirmedSkuCount:35,confirmedSoldUnits:173,resalableReturnedUnits:6,
  netManufacturingCostKopecks:39422300,costLines};
}
const older={vendor_code:'веста №2',valid_from:'2026-08-30',
 valid_to:null,cost_kopecks:420000,status:'preliminary'};
test('sync plans 35 October confirmations without overwriting earlier cost history',()=>{
 const x=buildOctoberWbSyncPlan(fixture(),[older]);
 assert.equal(x.inserts.length,35);
 assert.deepEqual(x.closeOlder,['веста №2']);
 assert.equal(x.alreadyConfirmed.length,0);
});
test('idempotent when all 35 are already saved and confirmed',()=>{
 const saved=fixture().costLines.map(x=>({
  vendor_code:x.vendorCode,valid_from:'2026-10-01',
  valid_to:'2026-10-31',cost_kopecks:x.unitCostKopecks,status:'confirmed'
 }));
 const r=buildOctoberWbSyncPlan(fixture(),saved);
 assert.equal(r.inserts.length,0);
 assert.equal(r.alreadyConfirmed.length,35);
});
test('refuses conflicting prices or future versions',()=>{
 const e=fixture();
 assert.throws(()=>buildOctoberWbSyncPlan(e,[{
  ...older,cost_kopecks:419999
 }]),/wb_sync_cost_conflict/);
 assert.throws(()=>buildOctoberWbSyncPlan(e,[{
  ...older,valid_from:'2026-10-10'
 }]),/wb_sync_historical_version_conflict/);
 assert.throws(()=>buildOctoberWbSyncPlan({
  ...e,netManufacturingCostKopecks:0
 },[]),/wb_sync_source_unverified/);
});
test('POST endpoint refuses unauthorized and cross-site writes',async()=>{
 const url='https://office.example/api/wb/cost-sync';
 const req=new Request(url,{method:'POST',headers:{Origin:'https://evil.example'}});
 const result=await onRequestPost({request:req,env:{}});
 assert.equal(result.status,403);
 const noAuth=await onRequestPost({request:new Request(url,{
  method:'POST',headers:{Origin:'https://office.example'}
 }),env:{}});
 assert.equal(noAuth.status,503);
});
