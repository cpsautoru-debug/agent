import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {projectOrderLine} from '../functions/api/orders/order-availability.js';
import {createStockPrecheck,validateStockRow} from '../functions/api/orders/order-stock-precheck.js';
const origin='https://autosklad63-office-staging.pages.dev';
const route=origin+'/api/orders/order-stock-precheck';
const key='AS63:yandex:149082506:live1';
const cookie=async()=>(await createSession('owner','unit-test')).split(';')[0];
const env=db=>({OFFICE_SESSION_SECRET:'unit-test',OFFICE_ALLOWED_EMAIL:'owner@example.test',
 OZON_FINANCE_DB:db,MS_API_TOKEN:'unit-token'});
const body=JSON.stringify({orderKey:key});
const request=async()=>new Request(route,{method:'POST',headers:{Origin:origin,
 Cookie:await cookie(),'Content-Type':'application/json'},body});
const owner=()=>({bind:()=>({first:async()=>({allowed:1})})});
test('accounting stock cannot approve picking or sewing without store, allocations and physical check',()=>{
 const x=projectOrderLine({ordered:5,stock:2,reserve:0,orderActive:true,itemConfirmed:true,
  storeConfirmed:true,stockConfirmed:true,allocationsConfirmed:true,otherAllocations:0});
 assert.equal(x.state,'accounting_projection_only');
 assert.equal(x.provisionalMissing,3);
 assert.equal(x.provisionalPick,2);
 assert.equal(x.pickable,null);
 assert.equal(x.missing,null);
 const y=projectOrderLine({ordered:5,stock:2,reserve:0,orderActive:true,itemConfirmed:true,
  storeConfirmed:false,stockConfirmed:true,allocationsConfirmed:true});
 assert.equal(y.state,'unverified');
 assert.equal(y.provisionalMissing,undefined);
 assert.equal(projectOrderLine({ordered:1,orderActive:false}).state,'not_for_sewing');
});
test('strict stock rows reject mismatched item or malformed stores',()=>{
 const href='https://api.moysklad.ru/api/remap/1.2/entity/product/12345678-1234-4234-9234-1234567890ab';
 const row={meta:{href},stockByStore:[{name:'Main',stock:5,reserve:3}]};
 assert.equal(validateStockRow(row,'product','12345678-1234-4234-9234-1234567890ab')[0].accountingFree,2);
 assert.throws(()=>validateStockRow(row,'variant','12345678-1234-4234-9234-1234567890ab'));
 assert.throws(()=>validateStockRow({...row,stockByStore:[{name:'Main',stock:'5',reserve:0}]},'product','12345678-1234-4234-9234-1234567890ab'));
});
test('history order never calls stock or approved SKU lookup',async()=>{
 let other=0;
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return owner();
  if(sql.includes('FROM office_order_queue WHERE'))return {bind:()=>({
   first:async()=>({order_key:key,source:'yandex',account:'149082506',
     source_status:'DELIVERED',source_checked_at:new Date().toISOString(),
     items_json:JSON.stringify([{sku:'sample',quantity:1}])})})};
  other++;throw Error('unexpected');
 }};
 const r=await createStockPrecheck({fetcher:()=>{throw Error('HTTP called');}})({
  request:await request(),env:env(db)});
 assert.equal(r.status,409);assert.equal((await r.json()).code,'order_not_active');
 assert.equal(other,0);
});
test('unmapped active order returns blocked per-line plan without external request',async()=>{
 const sourceStamp=new Date().toISOString();
 let calls=0;
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return owner();
  if(sql.includes('FROM office_order_queue WHERE'))return {bind:()=>({
   first:async()=>({order_key:key,source:'yandex',account:'149082506',
     source_status:'PROCESSING',source_checked_at:sourceStamp,
     items_json:JSON.stringify([{sku:'sample',quantity:2}])})})};
  if(sql.includes('FROM office_order_queue_sync'))return {bind:()=>({first:async()=>({last_success_at:sourceStamp})})};
  if(sql.includes('FROM office_order_sku_links'))return {bind:()=>({first:async()=>null})};
  throw Error('unexpected DB query');
 }};
 const r=await createStockPrecheck({fetcher:()=>{calls++;throw Error();}})({
  request:await request(),env:env(db)});
 const data=await r.json();
 assert.equal(r.status,200);
 assert.equal(data.sewingAllowed,false);
 assert.equal(data.rows[0].projection.reason,'item_mapping_unverified');
 assert.equal(data.rows[0].projection.missing,null);
 assert.equal(calls,0);
 assert.equal(data.changedMoySkladRecords,0);
});
test('active FBS check persists exact warehouse evidence but blocks picking and sewing',async()=>{
 const id='12345678-1234-4234-9234-1234567890ab';
 const org='12345678-1234-4234-9234-1234567890ac';
 const stamp=new Date().toISOString();
 const paths=[];
 let stored;
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return owner();
  if(sql.includes('FROM office_order_queue WHERE')&&sql.startsWith('SELECT'))return {bind:()=>({
   first:async()=>({order_key:key,source:'yandex',account:'149082506',
     source_status:'PROCESSING',source_checked_at:stamp,
     items_json:JSON.stringify([{sku:'sample',quantity:2}])})})};
  if(sql.includes('FROM office_order_queue_sync'))return {bind:()=>({first:async()=>({last_success_at:stamp})})};
  if(sql.includes('FROM office_order_warehouse_routes'))return {bind:()=>({first:async()=>({
   store_id:id,organization_id:org,store_kind:'retail'
  })})};
  if(sql.includes('INSERT INTO office_order_warehouse_checks'))return {bind:(...args)=>({
   run:async()=>{stored=args;return {meta:{changes:1}};}
  })};
  if(sql.includes('FROM office_order_sku_links'))return {bind:()=>({first:async()=>null})};
  throw Error('unexpected query');
 }};
 const handler=createStockPrecheck({fetcher:async(url,options)=>{
  paths.push(new URL(url).pathname);
  assert.equal(options.method,'GET');
  return Response.json({id:url.endsWith(id)?id:org,name:'Verified'});
 }});
 const result=await handler({request:await request(),env:env(db)});
 const data=await result.json();
 assert.equal(result.status,200);
 assert.equal(data.warehouse.status,'warehouse_verified');
 assert.equal(data.warehouse.storeId,id);
 assert.equal(data.warehouse.organizationId,org);
 assert.equal(stored[3],stamp);
 assert.equal(JSON.parse(stored[0]).storeId,id);
 assert.equal(paths.length,2);
 assert.equal(data.sewingAllowed,false);
 assert.equal(data.rows[0].projection.missing,null);
 assert.equal(data.changedMoySkladRecords,0);
});

test('historically active but absent from newest source snapshot is blocked',async()=>{
 let calls=0;
 const old=new Date(Date.now()-1000).toISOString();
 const current=new Date().toISOString();
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return owner();
  if(sql.includes('FROM office_order_queue WHERE'))return {bind:()=>({
   first:async()=>({order_key:key,source:'ozon',account:'test',
    source_status:'awaiting_packaging',source_checked_at:old,
    items_json:JSON.stringify([{sku:'sample',quantity:1}])})})};
  if(sql.includes('FROM office_order_queue_sync'))return {bind:()=>({first:async()=>({last_success_at:current})})};
  calls++;throw Error('should not reach any SKU or MoySklad queries');
 }};
 const result=await createStockPrecheck({fetcher:()=>{calls++;throw Error();}})({
  request:await request(),env:env(db)});
 assert.equal(result.status,409);
 assert.equal((await result.json()).code,'order_not_in_latest_snapshot');
 assert.equal(calls,0);
});
