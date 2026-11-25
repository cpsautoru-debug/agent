import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateFulfillmentCohort} from '../functions/api/orders/fulfillment-allocation.mjs';
const balance={status:'accounting_verified',stock:4,reserve:1};
const warehouseOccupancy={status:'warehouse_orders_verified',reconciledReserve:1,warehouseAdditional:2};
const production={status:'production_verified',jobs:[{
 id:'job-1',pending:2,due:'2026-11-28T00:00:00Z',customerOrderIds:[]}]};
const marketplaceCoverage={complete:true,deduplicated:true,
 allSourcesCurrent:true,allClaimsMapped:true};
const sourceSnapshot={complete:true};
const base={balance,warehouseOccupancy,production,marketplaceCoverage,sourceSnapshot,
 itemId:'item',warehouseId:'store'};
const claims=[{key:'ms-a',orderKey:'ms-a',identity:'ms:a',itemId:'item',storeId:'store',
 ordered:3,reserved:1,origin:'moysklad',deadline:'2026-11-27T00:00:00Z',orderId:'a'},
 {key:'market-b',orderKey:'market-b',identity:'market:b',itemId:'item',storeId:'store',
 ordered:3,reserved:0,origin:'marketplace',reconciledWithMoySklad:false,
 deadline:'2026-11-29T00:00:00Z'}];
test('complete shared cohort consumes stock and production only once',()=>{
 const r=calculateFulfillmentCohort({...base,claims});
 assert.equal(r.status,'calculated');
 assert.deepEqual(r.lines.map(x=>[x.warehouseCovered,x.plannedCovered,x.missing]),
  [[3,0,0],[1,2,0]]);
 assert.equal(r.lines.reduce((n,x)=>n+x.warehouseCovered,0),4);
 assert.equal(r.lines.reduce((n,x)=>n+x.plannedCovered,0),2);
});
test('unknown marketplace coverage blocks numeric sewing requirement',()=>{
 for(const patch of [{marketplaceCoverage:{...marketplaceCoverage,complete:false}},
  {sourceSnapshot:{complete:false}},{production:{status:'production_unverified',jobs:[]}}]){
  const r=calculateFulfillmentCohort({...base,claims,...patch});
  assert.equal(r.status,'requires_review');assert.equal(r.missing,null);
 }
});
test('unreconciled duplicate order identity blocks calculation',()=>{
 const duplicate={...claims[1],identity:'ms:a',key:'market-a',ordered:3};
 const r=calculateFulfillmentCohort({...base,claims:[claims[0],duplicate]});
 assert.equal(r.status,'requires_review');assert.equal(r.missing,null);
});
test('explicitly linked marketplace and MoySklad views count once',()=>{
 const duplicate={...claims[0],key:'market-a',orderKey:'market-a',origin:'marketplace',
  reserved:0,reconciledWithMoySklad:true};
 const r=calculateFulfillmentCohort({...base,claims:[claims[0],duplicate,claims[1]]});
 assert.equal(r.status,'calculated');assert.equal(r.lines.length,2);
 assert.equal(r.lines[0].orderKey,'market-a');
});
test('reserve mismatch prevents allocation',()=>{
 const r=calculateFulfillmentCohort({...base,
  warehouseOccupancy:{...warehouseOccupancy,reconciledReserve:0},claims});
 assert.equal(r.status,'requires_review');assert.equal(r.missing,null);
});
test('no due date prohibits counting planned work but still allocates available stock',()=>{
 const next=[claims[0],{...claims[1],deadline:null}];
 const r=calculateFulfillmentCohort({...base,claims:next});
 assert.equal(r.status,'calculated');assert.equal(r.lines[1].plannedCovered,0);
 assert.equal(r.lines[1].missing,2);
});
