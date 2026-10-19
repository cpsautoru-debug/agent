import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveVk,vkStatus} from './vk.mjs';
const env={VK_COMMUNITY_TOKEN:'token'.repeat(10),VK_GROUP_ID:'123',VK_CONFIRMATION_CODE:'sample-code',VK_CALLBACK_SECRET:'s'.repeat(40)};
const request=event=>(async function*(){yield Buffer.from(JSON.stringify(event));})();
test('VK setup exposes flags only and does not claim a verified connection',()=>{
  const status=vkStatus(env);assert.equal(status.tokenConfigured,true);assert.equal(status.autoReplies,false);assert.equal(status.autoPosts,false);assert.equal(JSON.stringify(status).includes(env.VK_COMMUNITY_TOKEN),false);
});
test('VK confirmation is bound to exact group and configured secret',async()=>{
  const event={type:'confirmation',group_id:123,secret:env.VK_CALLBACK_SECRET};assert.deepEqual(await receiveVk(request(event),env),{code:200,text:'sample-code'});
  assert.equal((await receiveVk(request({...event,group_id:999}),env)).code,403);assert.equal((await receiveVk(request({...event,secret:'wrong'}),env)).code,403);
});
test('VK callbacks fail closed before secret setup and forged events cannot pass',async()=>{
  const event={type:'message_new',group_id:123,secret:'wrong'};assert.equal((await receiveVk(request(event),env)).code,403);
  assert.equal((await receiveVk(request({...event,secret:env.VK_CALLBACK_SECRET}),{...env,VK_CALLBACK_SECRET:''})).code,403);
  assert.equal((await receiveVk(request({type:'wall_post_new',group_id:123,secret:env.VK_CALLBACK_SECRET}),env)).text,'ok');
});
test('VK callback rejects invalid JSON and oversized body',async()=>{
  assert.equal((await receiveVk((async function*(){yield Buffer.from('{');})(),env)).code,400);
  assert.equal((await receiveVk((async function*(){yield Buffer.alloc(32769);})(),env)).code,413);
});
