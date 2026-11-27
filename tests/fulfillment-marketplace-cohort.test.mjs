import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleLiveCohort,calculateLiveOrder} from '../functions/api/orders/fulfillment-marketplace-cohort.mjs';
const item='12345678-1234-4234-9234-1234567890ab';
const store='12345678-1234-4234-9234-1234567890ac';
const key='AS63:yandex:149082506:65143994624';
const row={order_key:key,source:'yandex',source_status:'PROCESSING',line_index:0,
 ms_item_id:item,store_id:store,quantity:1};
const proof={complete:true};
const base={itemId:item,storeId:store,orderKey:key,sourceCoverage:proof,
 accounting:{status:'accounting_verified',stock:14,reserve:0},
 occupancy:{status:'warehouse_orders_verified',warehouseAdditional:0,
  reconciledReserve:0,claims:[]},production:{status:'production_verified',jobs:[]}};
test('single proven current external claim can be supplied from available accounting stock',()=>{
 const r=calculateLiveOrder({...base,sourceLines:[row]});
 assert.equal(r.status,'calculated');assert.equal(r.lines[0].warehouseCovered,1);
 assert.equal(r.lines[0].missing,0);
});
test('MoySklad orders with unspecified origin do not silently double-count marketplace orders',()=>{
 const ms={key:'ms:x',orderKey:'ms:x',identity:'ms:x',origin:'moysklad',
  itemId:item,storeId:store,orderId:'x',ordered:3,reserved:0,deadline:null};
 const r=calculateLiveOrder({...base,sourceLines:[row],
  occupancy:{...base.occupancy,warehouseAdditional:3,claims:[ms]}});
 assert.equal(r.status,'requires_review');
 assert.equal(r.reason,'marketplace_duplicates_unverified');
 assert.equal(r.missing,null);
});
test('exact MoySklad external order identity reconciles a duplicate once',()=>{
 const ms={key:'ms:x',orderKey:'ms:x',identity:'ms:x',origin:'moysklad',
  itemId:item,storeId:store,orderId:'x',ordered:1,reserved:0,deadline:null,
  externalOrderKey:key};
 const r=calculateLiveOrder({...base,sourceLines:[row],
  occupancy:{...base.occupancy,warehouseAdditional:1,claims:[ms]}});
 assert.equal(r.status,'calculated',JSON.stringify(r));assert.equal(r.lines.length,1);
 assert.equal(r.lines[0].ordered,1);
});
test('missing mapping or warehouse and nonactive target cannot become numerical demand',()=>{
 assert.equal(assembleLiveCohort([{...row,ms_item_id:null}],[],item,store,key).status,'requires_review');
 assert.equal(assembleLiveCohort([{...row,store_id:null}],[],item,store,key).status,'requires_review');
 assert.equal(assembleLiveCohort([{...row,source_status:'DELIVERED'}],[],item,store,key).status,'requires_review');
 assert.equal(calculateLiveOrder({...base,sourceCoverage:{complete:false},sourceLines:[row]}).missing,null);
});
test('unique line identities are mandatory across a complete cohort',()=>{
 const x=assembleLiveCohort([row,row],[],item,store,key);
 assert.equal(x.status,'requires_review');
});

test('owner-confirmed independent WB exception excludes only exact unmapped SKU',()=>{
 const manual={...row,order_key:'AS63:wb:wb-primary:123',source:'wb',source_status:'wb_confirmed_assembly',sku:'Пламя1',ms_item_id:null};
 const r=calculateLiveOrder({...base,sourceLines:[row,manual]});
 assert.equal(r.status,'calculated');assert.equal(r.lines.length,1);
 for(const changed of [{ms_item_id:item},{order_key:'AS63:wb:other:123'},{quantity:0}]){
  const bad=calculateLiveOrder({...base,sourceLines:[row,{...manual,...changed}]});
  assert.equal(bad.reason,'manual_stock_scope_unverified');assert.equal(bad.missing,null);
 }
 assert.equal(calculateLiveOrder({...base,sourceCoverage:{complete:false},sourceLines:[row,manual]}).missing,null);
 assert.equal(assembleLiveCohort([manual],[],item,store,manual.order_key).status,'requires_review');
});
