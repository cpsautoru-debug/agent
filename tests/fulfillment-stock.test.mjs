import test from 'node:test';
import assert from 'node:assert/strict';
import {readStock, allocateStock} from '../functions/api/orders/fulfillment-stock.mjs';

const item='12345678-1234-4234-9234-1234567890ab';
const store='12345678-1234-4234-9234-1234567890ac';
test('stock and reserves are read by UUID and kept separate',async()=>{
 const result=await readStock(item,store,async path=>{
  const url=new URL(path,'https://api.moysklad.ru/api/remap/1.2/');
  assert.equal(url.searchParams.get('filter'),'assortmentId='+item);
  const field=url.searchParams.get('stockType');
  return [{assortmentId:item,storeId:store,[field]:field==='stock'?4:2}];
 });
 assert.deepEqual(result,{status:'accounting_verified',stock:4,reserve:2});
});
test('missing, recalculating and unassigned reserve evidence blocks allocation',async()=>{
 for(const rows of [[],[{assortmentId:item,storeId:store,stock:null,reserve:null}],
  [{assortmentId:item,storeId:null,stock:1,reserve:1}]]){
  assert.equal((await readStock(item,store,async()=>rows)).status,'availability_unverified');
 }
});
test('reconciles reserved quantities and consumes the shared pool only once',()=>{
 const lines=[{key:'a',ordered:3,reserved:2},{key:'b',ordered:3,reserved:0}];
 const balances={status:'accounting_verified',stock:4,reserve:2};
 assert.equal(allocateStock(balances,lines,false),null);
 assert.equal(allocateStock({...balances,reserve:1},lines,true),null);
 assert.deepEqual(allocateStock(balances,lines,true),[
  {key:'a',reserved:2,unreserved:1,covered:3,missing:0},
  {key:'b',reserved:0,unreserved:1,covered:1,missing:2}
 ]);
});

