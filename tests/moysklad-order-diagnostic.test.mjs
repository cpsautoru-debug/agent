import test from 'node:test';
import assert from 'node:assert/strict';
import {createMoyskladOrderDiagnostic} from
  '../functions/api/marketplace/moysklad-order-diagnostic.js';

const base='https://autosklad63-office-staging.pages.dev/api/marketplace/moysklad-order-diagnostic';
test('unauthenticated requests fail before contacting MoySklad',async()=>{
  let fetched=0;
  const handler=createMoyskladOrderDiagnostic({fetcher:()=>{
    fetched++;throw Error('must not call upstream');
  }});
  const bad=await handler({request:new Request(base+'?probe=all'),
    env:{OFFICE_SESSION_SECRET:'x'}});
  assert.equal(bad.status,400);
  const noAuth=await handler({request:new Request(base),env:{}});
  assert.equal(noAuth.status,503);
  assert.equal(fetched,0);
});
test('diagnostic does not accept write methods',async()=>{
  const handler=createMoyskladOrderDiagnostic({fetcher:()=>{
    throw Error('must not call upstream');
  }});
  const res=await handler({request:new Request(base,{method:'POST'}),env:{}});
  assert.equal(res.status,405);
});
