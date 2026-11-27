import test from 'node:test';
import assert from 'node:assert/strict';
import {staffProjection,STAFF_ROLES} from '../functions/api/orders/staff-projection.mjs';
const order={order_key:'a',source:'ozon',queue_bucket:'review',queue_reason:'awaiting_dispatch_no_sewing',items:[{sku:'vesta',quantity:1,transaction:{price:999}}],buyer:'private',profit:777};
const data={orders:[order,{...order,order_key:'b',queue_bucket:'history',queue_reason:'delivered'}],demand:{complete:true,readOnly:true,approvedForDispatch:false,rows:[{orderKey:'c',sku:'vesta',category:'sewing',quantity:2,price:999}]},picking:{complete:true,readOnly:true,approvedForDispatch:false,orders:[{orderKey:'d',source:'wb',items:[{sku:'vesta',quantity:1,price:999}]}]},coverageDiagnostics:{complete:true},operationalQueueTruncated:false};
test('role projections whitelist fields and never authorize writes',()=>{
 for(const role of STAFF_ROLES){const result=staffProjection(role,data);assert.equal(result.readOnly,true);assert.equal(result.approvedForDispatch,false);assert.equal(result.approvedForProduction,false);assert.equal(result.rows.length,1);assert.doesNotMatch(JSON.stringify(result),/profit|buyer|transaction|price|999|777|private/);}
 assert.throws(()=>staffProjection('owner',data));assert.throws(()=>staffProjection('finance',data));
});
test('unverified demand cannot appear as sewing or packing tasks',()=>{
 for(const role of ['sewing','cutting','packing'])for(const demand of [null,{...data.demand,complete:false},{...data.demand,approvedForDispatch:true}]){
 const result=staffProjection(role,{...data,demand});assert.equal(result.complete,false);assert.deepEqual(result.rows,[]);
 }
 assert.equal(staffProjection('dispatch',data).complete,false);
});
