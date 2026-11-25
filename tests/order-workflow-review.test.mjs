import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {nextState,createWorkflowReview} from '../functions/api/orders/workflow-review.js';
const origin='https://autosklad63-office-staging.pages.dev';
const url=origin+'/api/orders/workflow-review';
const key='AS63:yandex:149082506:active1';
const cookie=async()=>(await createSession('owner','workflow-secret')).split(';')[0];
const env=db=>({OFFICE_SESSION_SECRET:'workflow-secret',OFFICE_ALLOWED_EMAIL:'owner@x.test',OZON_FINANCE_DB:db});
const owner=()=>({bind:()=>({first:async()=>({allowed:1})})});
const req=async payload=>new Request(url,{method:'POST',headers:{
 Cookie:await cookie(),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
const time=()=>new Date().toISOString();
test('transition graph only permits preliminary owner review',()=>{
 assert.equal(nextState('pending_review','mark_reviewed'),'reviewed');
 assert.equal(nextState('reviewed','request_stock_check'),'stock_check_requested');
 assert.equal(nextState('stock_check_requested','hold'),'on_hold');
 assert.equal(nextState('on_hold','resume_review'),'pending_review');
 assert.equal(nextState('pending_review','request_stock_check'),null);
 assert.equal(nextState('reviewed','packed'),null);
 assert.equal(nextState('reviewed','shipped'),null);
});
test('historical, transit and FBO orders never reach D1 workflow writes',async()=>{
 for(const [source,source_status] of [['yandex','DELIVERED'],['yandex','CANCELLED'],
    ['yandex','DELIVERY'],['ozon_fbo','delivering']]){
  let writes=0;
  const db={prepare(sql){
   if(sql.includes('office_authorized_users'))return owner();
   if(sql.startsWith('SELECT order_key,source'))return {bind:()=>({
    first:async()=>({order_key:key,source,source_status,source_checked_at:time()})})};
   if(sql.includes('office_order_workflow'))writes++;
   throw Error('unexpected DB access');
  }};
  const result=await createWorkflowReview()({request:await req({orderKey:key,action:'mark_reviewed',expectedRevision:0}),env:env(db)});
  assert.equal(result.status,409);
  assert.equal((await result.json()).code,'order_not_active');
  assert.equal(writes,0);
 }
});
test('owner can only save active reviewed status with optimistic revision',async()=>{
 const sourceStamp=time();
 const statements=[];
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return owner();
  if(sql.startsWith('SELECT order_key,source'))return {bind:()=>({
   first:async()=>({order_key:key,source:'yandex',source_status:'PROCESSING',source_checked_at:sourceStamp})})};
  if(sql.includes('FROM office_order_queue_sync'))return {bind:()=>({first:async()=>({last_success_at:sourceStamp})})};
  if(sql.startsWith('SELECT workflow_state'))return {bind:()=>({first:async()=>null})};
  return {bind:(...params)=>({run:async()=>{statements.push({sql,params});return {success:true,meta:{changes:1}};}})};
 }};
 const result=await createWorkflowReview()({request:await req({orderKey:key,action:'mark_reviewed',expectedRevision:0}),env:env(db)});
 const data=await result.json();
 assert.equal(result.status,200);
 assert.equal(data.workflowState,'reviewed');
 assert.equal(data.changedMoySkladRecords,0);
 assert.equal(statements.length,1);
 assert.match(statements[0].sql,/INSERT INTO office_order_workflow/);
 assert.doesNotMatch(statements[0].sql,/entity\/customerorder|entity\/demand/);
});
test('stale source and invalid action fail without writes',async()=>{
 for(const checked of ['2020-01-01T00:00:00Z',time()]){
  let writes=0;
  const db={prepare(sql){
   if(sql.includes('office_authorized_users'))return owner();
   if(sql.startsWith('SELECT order_key,source'))return {bind:()=>({
    first:async()=>({order_key:key,source:'yandex',source_status:'PROCESSING',source_checked_at:checked})})};
   if(sql.startsWith('SELECT workflow_state'))return {bind:()=>({first:async()=>null})};
   writes++;throw Error('write not expected');
  }};
  const action=checked.startsWith('2020')?'mark_reviewed':'sent_to_sewing';
  const res=await createWorkflowReview()({request:await req({orderKey:key,action,expectedRevision:0}),env:env(db)});
  assert.notEqual(res.status,200);
  assert.equal(writes,0);
 }
});
test('workflow writes require owner session',async()=>{
 let calls=0;
 const handler=createWorkflowReview();
 const db={prepare(){calls++;throw Error('unexpected')}};
 const response=await handler({request:new Request(url,{method:'POST',headers:{Origin:origin},
  body:JSON.stringify({orderKey:key,action:'mark_reviewed',expectedRevision:0})}),env:env(db)});
 assert.equal(response.status,401);assert.equal(calls,0);
});

test('owner review rejects an order no longer in latest complete source snapshot',async()=>{
 const old=new Date(Date.now()-1000).toISOString();
 const current=time();
 let writes=0;
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))return owner();
  if(sql.startsWith('SELECT order_key,source'))return {bind:()=>({
   first:async()=>({order_key:key,source:'yandex',source_status:'PROCESSING',source_checked_at:old})})};
  if(sql.includes('FROM office_order_queue_sync'))return {bind:()=>({
   first:async()=>({last_success_at:current})})};
  writes++;throw Error('no review write expected');
 }};
 const r=await createWorkflowReview()({request:await req({
  orderKey:key,action:'mark_reviewed',expectedRevision:0}),env:env(db)});
 assert.equal(r.status,409);
 assert.equal((await r.json()).code,'order_not_in_latest_snapshot');
 assert.equal(writes,0);
});
