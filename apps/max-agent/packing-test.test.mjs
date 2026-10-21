import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packingTest} from './packing-test.mjs';
import {receiveSetup,webhookSecret} from './setup.mjs';
const event=(text,mid)=>({update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{text,mid}}});
test('owner completes isolated scenario; roles, semantic duplicates and restart are protected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'packing-sandbox-'));
 const env={MAX_OWNER_ID:'123',MAX_PACKING_TEST_ENABLED:'true',MAX_PACKING_TEST_DIR:dir};
 let n=0;const run=text=>packingTest(event(text,String(++n)),env);
 try{
  await run('/test');
  assert.match((await run('/test pack')).text,/роль|переход/);
  await run('/test role olga');await run('/test plan');
  await run('/test role alexandra');
  for(let i=1;i<=4;i++)await run('/test produce '+i);
  await run('/test produce 1');
  await run('/test role irina');await run('/test pack');await run('/test handover');
  await run('/test role dmitry');await run('/test accept');
  const s=JSON.parse(readFileSync(join(dir,'packing-test-v1.json'),'utf8'));
  assert.equal(s.produced,16);assert.equal(s.packed,15);assert.equal(s.accepted,15);
  assert.equal(s.produced-s.accepted,1);assert.equal(s.journal.filter(x=>x.action==='produce 1'&&x.status==='ok').length,1);
  const e=event('/test status','persistent-duplicate');
  assert.deepEqual(await packingTest(e,env),await packingTest(e,env));
  assert.match((await run('/test status')).text,/Списание: 0/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('disabled, unauthorized, group and stale commands cannot access storage',async()=>{
 const e=event('/test','x'),env={MAX_OWNER_ID:'123',MAX_PACKING_TEST_ENABLED:'true'};
 assert.match((await packingTest(e,{MAX_OWNER_ID:'123'})).text,/выключен/);
 e.message.sender.user_id=456;assert.deepEqual(await packingTest(e,env),{ignored:true});
 e.message.sender.user_id=123;e.message.recipient.chat_type='chat';assert.deepEqual(await packingTest(e,env),{ignored:true});
 e.message.recipient.chat_type='dialog';e.timestamp=0;assert.deepEqual(await packingTest(e,env),{ignored:true});
 assert.equal(await packingTest(event('/order','z'),env),null);
});
test('corrupt storage fails closed and is preserved',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'packing-sandbox-'));const file=join(dir,'packing-test-v1.json');
 try{writeFileSync(file,'broken');await assert.rejects(packingTest(event('/test','x'),{MAX_OWNER_ID:'123',MAX_PACKING_TEST_ENABLED:'true',MAX_PACKING_TEST_DIR:dir}));assert.equal(readFileSync(file,'utf8'),'broken');}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('webhook authenticates first; failed delivery retries only owner response without repeating action',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'packing-sandbox-'));
 const env={MAX_BOT_TOKEN:'fixture',MAX_OWNER_ID:'123',MAX_PACKING_TEST_ENABLED:'true',MAX_PACKING_TEST_DIR:dir};
 const e=event('/test plan','webhook-1');
 const req=(secret=webhookSecret('fixture'))=>({headers:{'x-max-bot-api-secret':secret},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(e));}});
 const seen=new Map(),state={registered:true,bridgeReady:true};let calls=0;
 const api=async(token,path)=>{assert.equal(path,'/messages?user_id=123');return {ok:++calls>1};};
 try{
  assert.equal(await receiveSetup(req('invalid'),env,api,seen,state),403);assert.equal(calls,0);
  assert.equal(await receiveSetup(req(),env,api,seen,state),503);
  assert.equal(await receiveSetup(req(),env,api,seen,state),200);
  assert.equal(JSON.parse(readFileSync(join(dir,'packing-test-v1.json'))).journal.length,1);
  e.message.sender.user_id=456;assert.equal(await receiveSetup(req(),env,api,seen,state),200);assert.equal(calls,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

