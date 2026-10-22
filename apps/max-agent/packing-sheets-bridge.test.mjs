import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {packingTest} from './packing-test.mjs';
import {sheetsTestConfig,syntheticEvents,flushSyntheticJournal} from './packing-sheets-bridge.mjs';
const config={url:'https://script.google.com/macros/s/AKfycbtest/exec',key:'k'.repeat(64)};
test('opt-in only, strict staging URL and secret',()=>{
 assert.equal(sheetsTestConfig({}),null);
 assert.throws(()=>sheetsTestConfig({MAX_TEST_SHEETS_URL:config.url}));
 assert.throws(()=>sheetsTestConfig({MAX_TEST_SHEETS_URL:'https://evil.test/exec',MAX_TEST_SHEETS_KEY:config.key}));
 assert.deepEqual(sheetsTestConfig({MAX_TEST_SHEETS_URL:config.url,MAX_TEST_SHEETS_KEY:config.key}),config);
});
test('durable synthetic journal replays after failure, sends HMAC, never duplicates after ack',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'packing-sheets-'));
 const env={MAX_OWNER_ID:'123',MAX_PACKING_TEST_ENABLED:'true',MAX_PACKING_TEST_DIR:dir};let mid=0;
 const run=async cmd=>packingTest({update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{mid:String(++mid),text:'/test orders '+cmd}}},env);
 try{
  await run('role alexandra');await run('produce TEST-OZ-1 2 sew-1');await run('role irina');await run('pack TEST-OZ-1 1 pack-1');
  const state=JSON.parse(readFileSync(join(dir,'packing-orders-v1.json'),'utf8'));
  const events=syntheticEvents(state);assert.equal(events.length,2);
  let received=[],failed=false;
  const fetcher=async(url,opts)=>{
   assert.equal(url,config.url);
   const envelope=JSON.parse(opts.body);
   assert.equal(envelope.signature,createHmac('sha256',config.key).update(envelope.timestamp+'\n'+envelope.body).digest('hex'));
   const data=JSON.parse(envelope.body);assert.equal(data.action,'test-event');
   if(!failed&&received.length===1){failed=true;throw Error('offline');}
   received.push(data.event);return Response.json({ok:true});
  };
  await assert.rejects(flushSyntheticJournal(dir,config,fetcher),/offline/);
  assert.equal(received.length,1);
  assert.equal(await flushSyntheticJournal(dir,config,fetcher),1);
  assert.equal(await flushSyntheticJournal(dir,config,fetcher),0);
  assert.deepEqual(received.map(x=>x.action),['produce','pack']);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
