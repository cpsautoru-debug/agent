import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffPreview} from '../functions/api/orders/staff-preview.js';
const base='https://autosklad63-office-staging.pages.dev/api/orders/staff-preview';
test('staff preview forwards owner session and returns only projected fields',async()=>{
 const handler=createStaffPreview({queue:async({request})=>{
 assert.equal(request.headers.get('Cookie'),'session=test');
 assert.equal(new URL(request.url).pathname,'/api/orders/persistent-queue');
 return Response.json({code:'persistent_queue_read',readOnly:true,orders:[{order_key:'a',source:'ozon',queue_bucket:'active',items:[{sku:'vesta',quantity:1,transaction:{price:999}}]}]});
 }});
 const r=await handler({request:new Request(base+'?role=orders',{headers:{Cookie:'session=test'}}),env:{}});
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.ownerPreview,true);assert.equal(d.rows.length,1);assert.doesNotMatch(JSON.stringify(d),/price|transaction|999/);
});
test('staff preview rejects unauthorized sessions, unknown roles and writes',async()=>{
 let calls=0;const handler=createStaffPreview({queue:async()=>{calls++;return new Response('',{status:403})}});
 for(const [suffix,method,status] of [['?role=finance','GET',400],['?role=orders&role=sewing','GET',400],['?role=orders','POST',405],['?role=orders','GET',403]]){
 const r=await handler({request:new Request(base+suffix,{method}),env:{}});assert.equal(r.status,status);
 }assert.equal(calls,1);
});
