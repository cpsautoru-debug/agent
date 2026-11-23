import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzonOrdersReadiness} from
  '../functions/api/ozon/orders-readiness.js';
const base='https://autosklad63-office-staging.pages.dev/api/ozon/orders-readiness';
test('readiness rejects unexpected queries and writes before contacting Ozon',async()=>{
  let calls=0;const handler=createOzonOrdersReadiness({fetcher:()=>{calls++;}});
  const p=await handler({request:new Request(base+'?debug=1'),env:{}});
  const w=await handler({request:new Request(base,{method:'POST'}),env:{}});
  assert.equal(p.status,400);
  assert.equal(w.status,405);
  assert.equal(calls,0);
});
test('readiness cannot assert success when authorization is unavailable',async()=>{
  let calls=0;const handler=createOzonOrdersReadiness({fetcher:()=>{calls++;}});
  const x=await handler({request:new Request(base),env:{}});
  assert.equal(x.status,503);
  assert.equal((await x.json()).code,'owner_auth_unavailable');
  assert.equal(calls,0);
});
