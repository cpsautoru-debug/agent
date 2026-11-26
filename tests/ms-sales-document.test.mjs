import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCustomerOrder,buildDemand} from '../functions/api/orders/ms-sales-document.mjs';
const id='7d3da55a-760f-11f1-0a80-066a00250941';
const base={key:'AS63:ozon:171189:123',source:'ozon',scheme:'FBS',createdAt:'2026-12-02 12:00:00',cutover:'2026-12-01 00:00:00',inventoryVerified:true,route:{store_kind:'manufacturer',store_id:id,organization_id:id},agentId:id,channelId:id,currency:'RUB',lines:[{type:'product',id,quantity:2,priceMinor:890000}],duplicate:'not_found'};
test('order draft preserves exact price and quantity',()=>{
 const doc=buildCustomerOrder(base);
 assert.equal(doc.applicable,false);
 assert.equal(doc.positions[0].price,890000);
 assert.equal(doc.positions[0].quantity,2);
 assert.equal(doc.externalCode,base.key);
});
test('historical, FBO, missing inventory and unknown duplicate rejected',()=>{
 for(const p of [{createdAt:'2026-11-30 12:00:00'},{scheme:'FBO'},{inventoryVerified:false},{duplicate:'unverified'},{currency:'USD'},{agentId:'bad'}])
 assert.throws(()=>buildCustomerOrder({...base,...p}));
});
test('shipment draft linked to order and verified whole shipment',()=>{
 const order=buildCustomerOrder(base);
 const input={order,orderId:id,shipmentKey:base.key+':shipment',shipmentMoment:'2026-12-03 12:00:00',cutover:base.cutover,inventoryVerified:true,shipmentVerified:true,duplicate:'not_found'};
 const doc=buildDemand(input);
 assert.equal(doc.applicable,false);
 assert.equal(doc.customerOrder.meta.type,'customerorder');
 assert.deepEqual(doc.positions,order.positions);
 for(const p of [{shipmentVerified:false},{duplicate:'already_exists'},{shipmentKey:'other'},{shipmentMoment:'2026-12-01 12:00:00'}])
 assert.throws(()=>buildDemand({...input,...p}));
});
