import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupChecks} from './readiness.mjs';
import {makeServer,startupChecks,EXPECTED_BOT} from './server.mjs';

test('startup is singleflight, bounded and does not repeat successful checks',async()=>{
  let webhook=0,bridge=0;const delays=[];
  const checks=createStartupChecks({webhook:async()=>({ok:++webhook===1}),bridge:async()=>({ok:++bridge===3})},{wait:async ms=>{delays.push(ms);}});
  const first=checks.start();assert.equal(checks.start(),first);await first;
  assert.equal(webhook,1);assert.equal(bridge,3);assert.deepEqual(delays,[1000,2000]);
  await checks.start();assert.equal(bridge,3);assert.equal(checks.snapshot().ready,true);
});
test('terminal errors and thrown secrets are sanitized',async()=>{
  let calls=0;const checks=createStartupChecks({webhook:async()=>{calls++;return {ok:false,terminal:true,code:'unauthorized'};},bridge:async()=>{throw Error('secret-personal-data');}},{wait:async()=>{}});
  await checks.start();assert.equal(calls,1);assert.equal(checks.snapshot().ready,false);
  assert.doesNotMatch(JSON.stringify(checks.snapshot()),/secret-personal-data/);
  assert.equal(checks.snapshot().checks.webhook.code,'unauthorized');
});
test('stop cancels backoff and prevents later attempts',async()=>{
  let calls=0;const checks=createStartupChecks({bridge:async()=>{calls++;return {ok:false};}});
  const done=checks.start();await new Promise(resolve=>setImmediate(resolve));checks.stop();await done;
  assert.equal(calls,1);assert.equal(checks.snapshot().checks.bridge.status,'stopped');
});
test('registration unknown outcome is terminal and bridge can retry independently',async()=>{
  let posts=0,pings=0;const state={};
  const checks=startupChecks({MAX_BOT_TOKEN:'secret',RENDER_EXTERNAL_URL:'https://autosklad63-max.onrender.com',SHEETS_BRIDGE_URL:'https://script.google.com/macros/s/test/exec',SHEETS_BRIDGE_KEY:'x'.repeat(64)},state,async(_token,path)=>{
    if(path==='/me')return {ok:true,data:{username:EXPECTED_BOT,is_bot:true}};
    posts++;throw Error('private');
  },async()=>({ok:++pings===3,spreadsheetMatches:true}),{wait:async()=>{}});
  await checks.start();assert.equal(posts,1);assert.equal(pings,3);assert.equal(state.bridgeReady,true);assert.equal(state.registered,false);
  assert.equal(checks.snapshot().checks.webhook.status,'failed');
});
test('health and readiness are passive and root reflects ready state',async()=>{
  let calls=0;const env={MAX_OWNER_ID:'123',MAX_WORK_CHAT_ID:'-456',MAX_BOT_TOKEN:'secret',SHEETS_BRIDGE_URL:'https://script.google.com/macros/s/test/exec',SHEETS_BRIDGE_KEY:'x'.repeat(64)};
  const state={registered:true,bridgeReady:true};
  const server=makeServer(env,async()=>{calls++;throw Error('network forbidden');},async()=>{calls++;},state);
  const request=path=>new Promise(resolve=>server.emit('request',{method:'GET',url:path},{setHeader(){},writeHead(code){this.code=code;},end(body){resolve({code:this.code,body});}}));
  const health=await request('/health');assert.equal(calls,0);assert.equal(JSON.parse(health.body).liveness,true);
  assert.equal((await request('/ready')).code,200);
  assert.match((await request('/')).body,/Приём заявок владельца подключён/);
  state.bridgeReady=false;assert.equal((await request('/ready')).code,503);assert.equal(calls,0);
});
