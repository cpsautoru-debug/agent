import test from 'node:test';
import assert from 'node:assert/strict';
import {maxRoute} from './max.mjs';
const admin='a'.repeat(64);
const call=(env={},auth=admin)=>{const url=new URL('https://example.com/api/max/connection');return maxRoute(new Request(url,{headers:{Authorization:'Bearer '+auth}}),env,url);};
test('MAX diagnostics require owner authorization and never expose token',async()=>{
  assert.equal((await call()).status,401);
  assert.equal((await call({ADMIN_TOKEN:admin},'wrong')).status,401);
  assert.equal((await (await call({ADMIN_TOKEN:admin})).json()).reason,'MAX_BOT_TOKEN missing');
});
test('MAX diagnostics accept only the approved bot and redact upstream errors',async()=>{
  const original=globalThis.fetch;const env={ADMIN_TOKEN:admin,MAX_BOT_TOKEN:'private-token'};
  try{
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://platform-api2.max.ru/me');assert.equal(options.headers.Authorization,'private-token');return Response.json({username:'id632135065259_2_bot',is_bot:true});};
    const valid=await (await call(env)).json();assert.equal(valid.connected,true);assert.equal(valid.sheetsWrite,false);assert.equal(valid.orderIntake,false);
    globalThis.fetch=async()=>Response.json({username:'another',is_bot:true});assert.equal((await (await call(env)).json()).connected,false);
    globalThis.fetch=async()=>Response.json({message:'private-token'},{status:401});assert.doesNotMatch(await (await call(env)).text(),/private-token/);
    globalThis.fetch=async()=>new Response('',{status:526});const tls=await (await call(env)).json();assert.equal(tls.configured,true);assert.match(tls.reason,/token validity unknown/);
    globalThis.fetch=async()=>{throw Error('private-token');};assert.doesNotMatch(await (await call(env)).text(),/private-token/);
  }finally{globalThis.fetch=original;}
});
test('MAX setup is not represented as an active order receiver',async()=>{
  const url=new URL('https://example.com/max/health');const r=await maxRoute(new Request(url),{},url);assert.equal((await r.json()).stage,'setup-only');
  const unrelated=new URL('https://example.com/webhook');assert.equal(await maxRoute(new Request(unrelated),{},unrelated),null);
});
