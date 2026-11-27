import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {sanitizeSourceOrder,validateSourceSnapshot,createPersistentQueue,classifyCurrentOrder}
 from '../functions/api/orders/persistent-queue.js';
import {classifyOrderBucket,bucketCounts} from '../functions/api/orders/order-buckets.js';
const origin='https://autosklad63-office-staging.pages.dev';
const route=origin+'/api/orders/persistent-queue';
const o={source:'yandex',externalKey:'AS63:yandex:149082506:12345',status:'PROCESSING',
 productionQueue:'candidate_needs_inventory',items:[{sku:'vesta_black',quantity:2}]};
const payload={code:'yandex_orders_preview_ok',readOnly:true,changedRecords:0,
 approvedForWrite:false,complete:true,hasNextPage:false,
 received:1,coverage:'BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE',orders:[o]};
test('October history is accepted only with its bounded scope and no all-open claim',()=>{
 const history={...payload,coverage:'BOTH_CAMPAIGNS_SINCE_2026_10_01_COMPLETE',
  allOpenVerified:false,scope:{fromDate:'2026-10-01',toDateExclusive:'2026-11-27',windows:2}};
 assert.equal(validateSourceSnapshot('yandex',history).length,1);
 for(const changed of [{allOpenVerified:true},{scope:null},
  {scope:{...history.scope,fromDate:'2026-11-01'}}])
  assert.throws(()=>validateSourceSnapshot('yandex',{...history,...changed}),/snapshot/);
});
const env=(db)=>({OFFICE_SESSION_SECRET:'test-owner-secret',
 OFFICE_ALLOWED_EMAIL:'owner@example.test',OZON_FINANCE_DB:db});
const cookie=async()=>(await createSession('owner','test-owner-secret')).split(';')[0];
test('mirror stores only safe order data, no PII and no shipping',()=>{
 const item=sanitizeSourceOrder('yandex',{...o,buyer:{name:'private'},address:'private'});
 assert.deepEqual(item.items,[{sku:'vesta_black',quantity:2}]);
 assert.equal(item.disposition,'candidate_needs_inventory');
 assert.ok(!JSON.stringify(item).includes('private'));
 const f=sanitizeSourceOrder('ozon_fbo',{...o,source:'ozon_fbo',
  externalKey:'AS63:ozon_fbo:store:543',productionQueue:'candidate_needs_inventory'});
 assert.equal(f.disposition,'not_for_sewing');
});
test('incomplete snapshot or duplicate IDs are rejected before D1',()=>{
 assert.throws(()=>validateSourceSnapshot('yandex',{...payload,complete:false}),/snapshot/);
 assert.throws(()=>validateSourceSnapshot('yandex',{...payload,orders:[o,o],received:2}),/duplicate/);
 assert.throws(()=>validateSourceSnapshot('yandex',{...payload,orders:[...Array(151)].map((_,i)=>({
  ...o,externalKey:'AS63:yandex:149082506:'+i})),received:151}),/snapshot/);
});
test('owner-only server fetch persists source-verified data in D1 batch',async()=>{
 const batch=[];
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return {bind:()=>({first:async()=>({allowed:1})})};
  if(sql.startsWith('SELECT last_success_at'))return {bind:()=>({first:async()=>null})};
  return {bind:(...values)=>({sql,values})};
 },batch:async tasks=>{batch.push(...tasks);return tasks.map(()=>({success:true}));}};
 let calls=0;
 const handler=createPersistentQueue({yandexHandler:async()=>{
  calls++;return Response.json(payload);
 }});
 const unauth=await handler({request:new Request(route,{method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({source:'yandex'})}),env:env(db)});
 assert.equal(unauth.status,401);assert.equal(calls,0);
 const r=await handler({request:new Request(route,{method:'POST',
  headers:{Origin:origin,Cookie:await cookie(),'Content-Type':'application/json'},
  body:JSON.stringify({source:'yandex'})}),env:env(db)});
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.changedMoySkladRecords,0);
 assert.equal(data.changedAccountingRecords,0);
 assert.equal(batch.length,2);assert.equal(calls,1);
 assert.ok(batch.every(q=>/office_order_queue/.test(q.sql)));
 assert.ok(!batch.some(q=>/DELETE FROM/.test(q.sql)));
});
test('invalid source and broken upstream never persist',async()=>{
 let calls=0;
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return {bind:()=>({first:async()=>({allowed:1})})};
  if(sql.startsWith('SELECT last_success_at'))return {bind:()=>({first:async()=>null})};
  throw Error('must never prepare for writing');
 }};
 const handler=createPersistentQueue({yandexHandler:async()=>{
  calls++;return Response.json({...payload,complete:false});
 }});
 const headers={Origin:origin,Cookie:await cookie(),'Content-Type':'application/json'};
 const bad=await handler({request:new Request(route,{method:'POST',headers,
  body:JSON.stringify({source:'unrecognized'})}),env:env(db)});
 assert.equal(bad.status,400);assert.equal(calls,0);
 const incomplete=await handler({request:new Request(route,{method:'POST',headers,
  body:JSON.stringify({source:'yandex'})}),env:env(db)});
 assert.equal(incomplete.status,503);assert.equal(calls,1);
 assert.equal((await incomplete.json()).changedRecords,0);
});

test('source-status buckets never authorize sewing for history, delivery or unknown',()=>{
 const rows=[
  ...Array.from({length:31},()=>({source:'yandex',source_status:'DELIVERED'})),
  ...Array.from({length:24},()=>({source:'yandex',source_status:'CANCELLED'})),
  ...Array.from({length:11},()=>({source:'yandex',source_status:'DELIVERY'})),
  ...Array.from({length:3},()=>({source:'yandex',source_status:'PICKUP'})),
  ...Array.from({length:9},()=>({source:'ozon_fbo',source_status:'delivering'})),
  ...Array.from({length:3},()=>({source:'ozon_fbo',source_status:'delivered'})),
  ...Array.from({length:3},()=>({source:'ozon_fbo',source_status:'cancelled'}))
 ];
 assert.deepEqual(bucketCounts(rows),{active:0,transit:23,history:61,review:0});
 assert.ok(rows.every(row=>classifyOrderBucket(row).sewingAllowed===false));
 assert.equal(classifyOrderBucket({source:'yandex',source_status:'PROCESSING'}).bucket,'active');
 assert.equal(classifyOrderBucket({source:'yandex',source_status:'UNPAID'}).bucket,'review');
 assert.equal(classifyOrderBucket({source:'yandex',source_status:'UNPAID'}).sewingAllowed,false);
 assert.equal(classifyOrderBucket({source:'ozon',source_status:'awaiting_packaging'}).bucket,'active');
 assert.equal(classifyOrderBucket({source:'ozon_fbo',source_status:'awaiting_packaging'}).bucket,'review');
 assert.equal(classifyOrderBucket({source:'avito',source_status:'Regular'}).bucket,'review');
 assert.equal(classifyOrderBucket({source:'yandex',source_status:'UNKNOWN_NEW_STATUS'}).bucket,'review');
});


test('current snapshot classification uses shared manual source and fails closed on missing evidence',()=>{
 const stamp='2026-11-27T03:00:00.000Z',older='2026-11-26T03:00:00.000Z';
 const sync=new Map([['manual',stamp],['ozon',stamp]]);
 for(const source of ['avito','plamya','dealer_ruslan','dealer_irina']){
  const row={source,source_status:'Regular',source_checked_at:older};
  assert.equal(classifyCurrentOrder(row,sync).reason,'not_in_latest_source_snapshot');
  assert.equal(classifyCurrentOrder({...row,source_checked_at:stamp},sync).reason,'manual_status_requires_verification');
 }
 const row={source:'ozon',source_status:'awaiting_packaging',source_checked_at:stamp};
 assert.equal(classifyCurrentOrder(row,sync).bucket,'active');
 assert.equal(classifyCurrentOrder(row,new Map()).reason,'source_snapshot_missing');
 assert.equal(classifyCurrentOrder({...row,source_checked_at:older},sync).bucket,'review');
 assert.equal(classifyCurrentOrder({...row,source_status:'delivered'},new Map()).bucket,'history');
});

import {prioritizeUnmappedSkus} from '../web/office/saved-sku-confirmation.mjs';
test('SKU batch prioritizes current active orders and preserves account identity',()=>{
 const row={source:'yandex',account:'149082506',queue_bucket:'active',items:[{sku:'a'},{sku:'b'},{sku:'a'}]};
 const rows=[row,{...row,queue_bucket:'history',items:[{sku:'old'}]},{...row,queue_bucket:'review',items:[{sku:'stale'}]},{...row,source:'ozon_fbo',items:[{sku:'fbo'}]},{...row,account:'149106500'}];
 const result=prioritizeUnmappedSkus(rows,new Set([JSON.stringify(['yandex','149082506','a'])]));
 assert.deepEqual(result.map(x=>[x.sellerAccount,x.sku]),[['149082506','b'],['149106500','a'],['149106500','b']]);
});

test('WB capacity allows 300 orders in a single atomic snapshot but not 301',async()=>{const {saveSourceSnapshot}=await import('../functions/api/orders/persistent-queue.js');const orders=Array.from({length:300},(_,i)=>({...o,source:'wb',externalKey:'AS63:wb:wb-primary:'+(i+1)}));const snapshot={...payload,code:'marketplace_order_import_preview_ok',source:'wb',orders,counts:{received:300}};assert.equal(validateSourceSnapshot('wb',snapshot).length,300);let batches=0;const db={prepare:sql=>({bind:(...args)=>({sql,args})}),batch:async tasks=>{batches++;assert.equal(tasks.length,301);return tasks.map(()=>({success:true}));}};assert.equal((await saveSourceSnapshot(db,'wb',snapshot)).status,200);assert.equal((await saveSourceSnapshot(db,'wb',{...snapshot,orders:[...orders,{...orders[0],externalKey:'AS63:wb:wb-primary:301'}],counts:{received:301}})).status,503);assert.equal(batches,1);});
