import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker, {draftRows} from './worker.mjs';
const now=Date.now();
const payload={object:'instagram',entry:[{id:'123',messaging:[{sender:{id:'456'},recipient:{id:'123'},timestamp:now,message:{mid:'m1',text:'Как оплатить?'}}]}]};
test('only own account; FAQ stays a draft; expired messages cannot become current drafts',()=>{
  assert.equal(draftRows(payload,'999',now).length,0);
  const [event]=draftRows(payload,'123',now);
  assert.equal(event.status,'draft'); assert.match(event.draft,/наложенным/);
  assert.equal(draftRows(payload,'123',now+86400001)[0].status,'expired');
});
test('verification and private API reject missing or wrong secrets',async()=>{
  const call=(url,env={})=>worker.fetch(new Request('https://example.com'+url),env);
  assert.equal((await call('/api/drafts')).status,401);
  assert.equal((await call('/webhook?hub.mode=subscribe&hub.verify_token=bad',{META_VERIFY_TOKEN:'good'})).status,403);
  assert.equal(await (await call('/webhook?hub.mode=subscribe&hub.verify_token=good&hub.challenge=42',{META_VERIFY_TOKEN:'good'})).text(),'42');
});
test('webhook verifies original bytes, saves atomically, and does not acknowledge storage failure',async()=>{
  const raw=JSON.stringify(payload), secret='test-secret'; const statements=[];
  const DB={prepare:sql=>({bind:(...args)=>{statements.push({sql,args});return args;}}),batch:async()=>{}};
  const send=(signature,db=DB)=>worker.fetch(new Request('https://example.com/webhook',{method:'POST',headers:{'x-hub-signature-256':signature},body:raw}),{DB:db,META_APP_SECRET:secret,INSTAGRAM_ACCOUNT_ID:'123'});
  assert.equal((await send('bad')).status,403); assert.equal(statements.length,0);
  const sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal((await send(sig)).status,200);
  assert.match(statements[0].sql,/INSERT OR IGNORE/); assert.equal(statements[0].args[0],'dm:m1');
  assert.equal((await send(sig,{...DB,batch:async()=>{throw Error('offline');}})).status,503);
});
test('oversized body is rejected before parsing and saving',async()=>{
  const response=await worker.fetch(new Request('https://example.com/webhook',{method:'POST',body:'x'.repeat(262145)}),{DB:{},META_APP_SECRET:'secret',INSTAGRAM_ACCOUNT_ID:'123'});
  assert.equal(response.status,413);
});
