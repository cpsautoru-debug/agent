import test from 'node:test';
import assert from 'node:assert/strict';
import {readProduction, allocateProduction} from '../functions/api/orders/fulfillment-production.mjs';
const id='12345678-1234-4234-9234-1234567890ab';
const store='12345678-1234-4234-9234-1234567890ac';
const task='12345678-1234-4234-9234-1234567890ad';
const row='12345678-1234-4234-9234-1234567890ae';
const prefix='https://api.moysklad.ru/api/remap/1.2/entity/';
const ref=path=>({meta:{href:prefix+path}});
const rowRef=ref('productiontask/'+task+'/productionRows/'+row);
const page=rows=>({meta:{size:rows.length},rows});
const taskDoc={id:task,applicable:true,awaiting:true,productsStore:ref('store/'+store),
 deliveryPlannedMoment:'2027-01-01 10:00:00.000',customerOrders:[]};
test('unfinished final stage is separated from completed production by exact output SKU',async()=>{
 const result=await readProduction(id,store,async path=>{
  if(path.startsWith('entity/productiontask?'))return page([taskDoc]);
  if(path.includes('/products?'))return page([{id:row,assortment:ref('product/'+id),planQuantity:10,productionRow:rowRef}]);
  if(path.includes('/productionRows?'))return page([{id:row,productionVolume:5,processingPlan:ref('processingplan/'+id)}]);
  if(path.startsWith('entity/productionstage?'))return page([
   {id,productionTask:ref('productiontask/'+task),productionRow:rowRef,orderingPosition:0,totalQuantity:5,completedQuantity:4},
   {id:store,productionTask:ref('productiontask/'+task),productionRow:rowRef,orderingPosition:1,totalQuantity:5,completedQuantity:1}
  ]);
  assert.fail(path);
 });
 assert.equal(result.status,'production_verified');
 assert.equal(result.jobs[0].completed,2);
 assert.equal(result.jobs[0].pending,8);
});
test('incomplete tasks and invalid output store fail closed',async()=>{
 assert.equal((await readProduction(id,store,async()=>({meta:{size:99},rows:[]}))).status,'production_unverified');
 assert.equal((await readProduction(id,store,async()=>page([{...taskDoc,productsStore:null}]))).status,'production_unverified');
});
test('linked production and free production cannot be allocated twice',()=>{
 const jobs=[{id:task,pending:2,customerOrderIds:[row],due:'2027-01-01T07:00:00Z'},
  {id:id,pending:2,customerOrderIds:[],due:'2027-01-01T07:00:00Z'}];
 const lines=[{key:'a',orderId:null,missing:3,deadline:'2027-01-02T00:00:00Z'},
  {key:'b',orderId:row,missing:3,deadline:'2027-01-02T00:00:00Z'}];
 assert.deepEqual(allocateProduction(jobs,lines).map(({planned,missing})=>[planned,missing]),[[2,1],[2,1]]);
});
