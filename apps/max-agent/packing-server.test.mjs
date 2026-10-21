import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packingConfig,startPackingWebhook,makePackingServer,packingSecret} from './packing-server.mjs';
const config=()=>({MAX_TEST_BOT_TOKEN:'fixture',MAX_TEST_BOT_USERNAME:'fixture_test_bot',MAX_TEST_OWNER_ID:'123',MAX_TEST_PUBLIC_URL:'https://autosklad63-max-packing-test.onrender.com',MAX_PACKING_TEST_DIR:join(tmpdir(),'packing-fixture')});
test('sandbox refuses production identity, production credentials and invalid configuration',()=>{
 assert.throws(()=>packingConfig({...config(),MAX_TEST_BOT_USERNAME:'id632135065259_2_bot'}));
 for(const key of ['MAX_BOT_TOKEN','GOOGLE_SHEETS_BRIDGE_URL','MOYSKLAD_API_TOKEN','VK_ACCESS_TOKEN'])assert.throws(()=>packingConfig({...config(),[key]:'forbidden'}));
 assert.throws(()=>packingConfig({...config(),MAX_TEST_PUBLIC_URL:'https://autosklad63-max.onrender.com'}));
 assert.throws(()=>packingConfig({...config(),MAX_TEST_OWNER_ID:'0'}));
});
test('register only verified separate bot; account mismatch never changes subscriptions',async()=>{
 const c=packingConfig(config());let calls=[];
 assert.equal(await startPackingWebhook(c,async(_t,path)=>{calls.push(path);return {ok:true,data:{username:'id632135065259_2_bot',is_bot:true}};}),false);
 assert.deepEqual(calls,['/me']);calls=[];
 assert.equal(await startPackingWebhook(c,async(_t,path,body)=>{calls.push(path);if(path==='/me')return {ok:true,data:{username:c.username,is_bot:true}};if(!body)return {ok:true,data:{subscriptions:[]}};assert.equal(body.url,c.url+'/max/webhook');return {ok:true,data:{success:true}};}),true);
 assert.deepEqual(calls,['/me','/subscriptions','/subscriptions']);
 let writes=0;
 const codes=[];
 assert.equal(await startPackingWebhook(c,async(_t,path,body)=>{if(body)writes++;return path==='/me'?{ok:true,data:{username:c.username,is_bot:true}}:{ok:true,data:{subscriptions:[{url:'https://other-service.invalid/webhook'}]}};},code=>codes.push(code)),false);
 assert.equal(writes,0);
 assert.deepEqual(codes,['existing-subscription']);
});
test('test server accepts only signed owner test commands, exposes no business routes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'packing-live-adapter-'));
 const c=packingConfig({...config(),MAX_PACKING_TEST_DIR:dir});let sent=0;
 const server=makePackingServer(c,async(_t,path)=>{assert.equal(path,'/messages?user_id=123');sent++;return {ok:true};},{registered:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const e={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{text:'/test',mid:'test'}}};
 const post=(secret=packingSecret(c.token))=>fetch(base+'/max/webhook',{method:'POST',headers:{'X-Max-Bot-Api-Secret':secret},body:JSON.stringify(e)});
 try{
  assert.equal((await post('forged')).status,403);assert.equal(sent,0);
  assert.equal((await post()).status,200);assert.equal(sent,1);
  e.message.body.text='/confirm fake';assert.equal((await post()).status,200);assert.equal(sent,1);
  e.message.body.text='/test';e.message.sender.user_id=456;await post();assert.equal(sent,1);
  assert.equal((await fetch(base+'/api/moysklad')).status,404);
  assert.equal((await fetch(base+'/health')).status,200);
 }finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
