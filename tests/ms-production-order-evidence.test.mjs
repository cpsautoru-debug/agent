import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskOrderLinks,summarizeLinkedOrder,createProductionOrderEvidenceHandler
} from '../functions/api/ms/production-order-evidence.js';
const uuid='01234567-89ab-4cde-8fab-0123456789ab';
const uri='https://api.moysklad.ru/api/remap/1.2/entity/customerorder/'+uuid;
test('no customer order references are never reported as active work',()=>{
  assert.deepEqual(parseTaskOrderLinks([]),{status:'none',reason:null,ids:[]});
  assert.equal(parseTaskOrderLinks(undefined).status,'unverified');
  assert.equal(parseTaskOrderLinks([{meta:{href:uri}}]).status,'linked');
});
test('invalid, duplicated and unbounded links fail closed',()=>{
  assert.equal(parseTaskOrderLinks([{meta:{href:'https://example.com/order/'+uuid}}]).status,'unverified');
  assert.equal(parseTaskOrderLinks([{meta:{href:uri}},{meta:{href:uri}}]).status,'unverified');
  assert.equal(parseTaskOrderLinks(Array.from({length:4},()=>({meta:{href:uri}}))).status,'unverified');
});
test('state is shown as raw name, not interpreted as live or closed',()=>{
  const e=summarizeLinkedOrder({id:uuid,applicable:true,
    state:{name:'В обработке'},updated:'2026-11-23 10:00:00'},uuid);
  assert.equal(e.verification,'state_read');
  assert.equal(e.stateName,'В обработке');
  assert.equal(e.posted,true);
  assert.equal('active' in e,false);
  assert.equal(summarizeLinkedOrder({id:uuid,applicable:false},uuid).verification,'state_missing');
  assert.equal(summarizeLinkedOrder({id:'other',applicable:true},uuid).verification,'unverified');
});
test('known order state remains verifiable without optional applicable field',()=>{
  const e=summarizeLinkedOrder({id:uuid,state:{name:'В работе'},
    updated:'2026-11-23 10:00:00'},uuid);
  assert.equal(e.verification,'state_read');
  assert.equal(e.posted,null);
  assert.equal(e.stateName,'В работе');
  assert.equal('active' in e,false);
});
test('public endpoint never reads a task without authentication',async()=>{
  const handler=createProductionOrderEvidenceHandler({fetcher:()=>{
    throw Error('must not fetch');}});
  const req=new Request('https://autosklad63-office-staging.pages.dev/api/ms/production-order-evidence?number=00078');
  const response=await handler({request:req,env:{}});
  assert.equal(response.status,503);
  const wrong=await handler({request:new Request(
    'https://autosklad63-office-staging.pages.dev/api/ms/production-order-evidence?number=00078&number=00079'
  ),env:{}});
  assert.equal(wrong.status,400);
});
