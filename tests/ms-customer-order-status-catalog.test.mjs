import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOrderStates,createOrderStatusCatalogHandler} from
  '../functions/api/ms/customer-order-status-catalog.js';
const id='01234567-89ab-4cde-8fab-0123456789ab';
const other='11111111-1111-4111-8111-111111111111';
test('catalog returns strict source statuses without guessing activity',()=>{
  const r=normalizeOrderStates({states:[
    {id,name:'В производстве'},{id:other,name:'Отменён'}
  ]});
  assert.equal(r.count,2);
  assert.deepEqual(r.states.map(x=>x.name),['В производстве','Отменён']);
  assert.equal(r.interpretation,
    'UNMAPPED_SOURCE_STATES_NOT_ACTIVE_ORDER_CLASSIFICATION');
  assert.equal('active' in r.states[0],false);
});
test('invalid status identifiers, duplicate names or missing states are rejected',()=>{
  assert.throws(()=>normalizeOrderStates({}),/ms_order_states_missing/);
  assert.throws(()=>normalizeOrderStates({states:[{id:'bad',name:'В работе'}]}),
    /ms_order_state_invalid/);
  assert.throws(()=>normalizeOrderStates({states:[
    {id,name:'Новый'},{id:other,name:'новый'}
  ]}),/ms_order_state_invalid/);
});
test('unauthenticated request cannot fetch metadata',async()=>{
  const handler=createOrderStatusCatalogHandler({fetcher:()=>{
    throw Error('upstream called without auth');
  }});
  const response=await handler({request:new Request(
    'https://autosklad63-office-staging.pages.dev/api/ms/customer-order-status-catalog'
  ),env:{}});
  assert.equal(response.status,503);
  const invalid=await handler({request:new Request(
    'https://autosklad63-office-staging.pages.dev/api/ms/customer-order-status-catalog?debug=1'
  ),env:{}});
  assert.equal(invalid.status,400);
});

test('source terminal state types are explicit, regular is not treated as active',()=>{
  const id='01234567-89ab-4cde-8fab-0123456789ab';
  const a=normalizeOrderStates({states:[
    {id,name:'В пути',stateType:'Regular'},
    {id:'11111111-1111-4111-8111-111111111111',name:'Сдано',stateType:'Successful'}
  ]});
  assert.equal(a.states[0].terminal,false);
  assert.equal(a.states[1].terminal,true);
  assert.equal(normalizeOrderStates({states:[{id,name:'Неизвестно'}]}).states[0].terminal,null);
});
