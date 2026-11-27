import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompletePages,readOccupancy} from '../functions/api/orders/fulfillment-occupancy.mjs';
const id='12345678-1234-4234-9234-1234567890ab';
const store='12345678-1234-4234-9234-1234567890ac';
const other='12345678-1234-4234-9234-1234567890ad';
const root='https://api.moysklad.ru/api/remap/1.2/entity/';
const ref=href=>({meta:{href:root+href}});
const page=rows=>({meta:{size:rows.length},rows});
test('requires all pages, stable counts and unique IDs',async()=>{
 const read=async path=>({meta:{size:2,offset:path.endsWith('offset=0')?0:1},
  rows:[{id:path.endsWith('offset=0')?id:other}]});
 assert.equal((await readCompletePages(read,'entity/customerorder',{limit:1,maxPages:2})).length,2);
 await assert.rejects(readCompletePages(read,'entity/customerorder',{limit:1,maxPages:1}));
 await assert.rejects(readCompletePages(async()=>({meta:{size:2},rows:[{id}]}),
  'entity/customerorder',{limit:1,maxPages:2}));
});
test('reconciles reserve once and subtracts shipped positions from open claims',async()=>{
 const balance={status:'accounting_verified',stock:53,reserve:2};
 const read=async path=>{
  if(!path.includes('/positions?'))return page([
   {id,applicable:true,state:{stateType:'Regular'},store:ref('store/'+store)},
   {id:other,applicable:true,state:{stateType:'Unsuccessful'},store:ref('store/'+store)}
  ]);
  return page([{id:store,assortment:ref('product/'+id),quantity:5,
   shipped:1,reserve:path.includes(id+'/positions?')?2:0}]);
 };
 assert.deepEqual(await readOccupancy('product',id,store,balance,read),{
  status:'warehouse_orders_verified',ordersSeen:2,matchingOrders:2,reconciledReserve:2,warehouseAdditional:2,
  claims:[{key:'ms:'+id,orderKey:'ms:'+id,identity:'ms:'+id,
    origin:'moysklad',itemId:id,storeId:store,ordered:4,reserved:2,
    orderId:id,deadline:null}]
 });
 assert.equal((await readOccupancy('product',id,store,{...balance,reserve:0},read)).reason,'reserve_mismatch');
 assert.equal((await readOccupancy('product',id,store,balance,async()=>{throw Error();})).status,'availability_unverified');
});
test('explicit complete empty customer order scope is separate from marketplace coverage',async()=>{
 const result=await readOccupancy('product',id,store,{status:'accounting_verified',stock:53,reserve:0},async()=>page([]));
 assert.equal(result.status,'warehouse_orders_verified');
 assert.equal(result.warehouseAdditional,0);
 assert.deepEqual(result.claims,[]);
});

test('filtered occupancy requests exact SKU, preserves claims and detects unrelated results',async()=>{
 const balance={status:'accounting_verified',stock:3,reserve:0};
 const order={id:other,applicable:true,state:{stateType:'Regular'},store:ref('store/'+store)};
 const line={id:store,assortment:ref('product/'+id),quantity:2,shipped:1,reserve:0};
 const paths=[];
 const result=await readOccupancy('product',id,store,balance,async path=>{
  paths.push(path);
  if(path.includes('/positions?'))return page([line]);
  assert.equal(new URL(path,'https://local.invalid').searchParams.get('filter'),'store='+root+'store/'+store+';assortment='+root+'product/'+id);
  return page([order]);
 },{filtered:true});
 assert.equal(result.status,'warehouse_orders_verified');
 assert.equal(result.warehouseAdditional,1);
 assert.equal(paths.length,2);
 const full=await readOccupancy('product',id,store,balance,async path=>path.includes('/positions?')?page([line]):page([order]));
 assert.deepEqual(result,full);
 const invalid=await readOccupancy('product',id,store,balance,async path=>path.includes('/positions?')?page([{...line,assortment:ref('product/'+other)}]):page([order]),{filtered:true});
 assert.equal(invalid.status,'availability_unverified');
 const mismatch=await readOccupancy('product',id,store,{...balance,reserve:1},async path=>path.includes('/positions?')?page([line]):page([order]),{filtered:true});
 assert.equal(mismatch.reason,'reserve_mismatch');
});
