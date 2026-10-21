import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {queryBot,makeServer,EXPECTED_BOT} from './server.mjs';
import {setupSubscription,setupIdentity,webhookSecret,workChatConfigured,isWorkChat,receiveSetup} from './setup.mjs';
test('intake does not acknowledge failed MAX delivery or suppress its retry',async()=>{
 const env={MAX_BOT_TOKEN:'secret',MAX_OWNER_ID:'123',MAX_WORK_CHAT_ID:'-456'},seen=new Map(),state={registered:true,bridgeReady:false};
 const event={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{mid:'retry-fixture',text:'Принять заявку\n1) Тест — 1 шт.'}}};
 const req=()=>({headers:{'x-max-bot-api-secret':webhookSecret('secret')},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(event));}});
 let sends=0;const api=async()=>({ok:++sends>1});
 assert.equal(await receiveSetup(req(),env,api,seen,state),503);
 assert.equal(await receiveSetup(req(),env,api,seen,state),200);
 assert.equal(sends,2);
 assert.equal(await receiveSetup(req(),env,api,seen,state),200);
 assert.equal(sends,2);
});
test('intake concurrent delivery and thrown delivery remain retryable',async()=>{
 const env={MAX_BOT_TOKEN:'secret',MAX_OWNER_ID:'123',MAX_WORK_CHAT_ID:'-456'},seen=new Map(),state={registered:true,bridgeReady:false};
 const event={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{mid:'concurrent-fixture',text:'Принять заявку\n1) Тест — 1 шт.'}}};
 const req=()=>({headers:{'x-max-bot-api-secret':webhookSecret('secret')},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(event));}});
 let release,started;const startedPromise=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const first=receiveSetup(req(),env,async()=>{started();await gate;throw Error('fixture');},seen,state);
 await startedPromise;
 assert.equal(await receiveSetup(req(),env,async()=>{throw Error('must not send concurrently');},seen,state),503);
 release();assert.equal(await first,503);assert.equal(seen.size,0);
 assert.equal(await receiveSetup(req(),env,async()=>({ok:true}),seen,state),200);
});
function fake(data,status=200){return (url,options,cb)=>{
  assert.equal(url,'https://platform-api2.max.ru/me');assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.ca.length,2);assert.equal(options.headers.Authorization,'secret');
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
  req.end=()=>{const res=new EventEmitter();res.statusCode=status;res.setEncoding=()=>{};res.destroy=()=>{};cb(res);res.emit('data',JSON.stringify(data));res.emit('end');};return req;
};}
test('only approved bot is accepted and upstream private fields are not returned',async()=>{
  const result=await queryBot('secret',fake({username:EXPECTED_BOT,is_bot:true,token:'secret',user_id:123}));assert.equal(result.connected,true);assert.doesNotMatch(JSON.stringify(result),/secret|123/);
  assert.equal((await queryBot('secret',fake({username:'other',is_bot:true}))).connected,false);
  assert.equal((await queryBot('secret',fake({error:'secret'},401))).http,401);
});

test('webhook registration is restricted to own deployment and correct bot',async()=>{
  let calls=0;const api=async(_token,path,body)=>{
    calls++;if(path==='/me')return {ok:true,data:{username:EXPECTED_BOT,is_bot:true}};
    assert.equal(path,'/subscriptions');assert.equal(body.url,'https://autosklad63-max.onrender.com/max/webhook');assert.deepEqual(body.update_types,['bot_started','message_created']);assert.equal(body.secret,webhookSecret('secret'));return {ok:true,data:{success:true}};
  };
  assert.equal((await setupSubscription({MAX_BOT_TOKEN:'secret',RENDER_EXTERNAL_URL:'https://another.onrender.com'},api)).registered,false);assert.equal(calls,0);
  assert.equal((await setupSubscription({MAX_BOT_TOKEN:'secret',RENDER_EXTERNAL_URL:'https://autosklad63-max.onrender.com'},api)).registered,true);
});
test('identity setup ignores normal text, groups, bots and stale events',()=>{
  const event={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'dialog'},body:{mid:'test',text:'/start'}}};
  assert.equal(setupIdentity(event).user,123);
  for(const patch of [{...event,timestamp:1},{...event,message:{...event.message,body:{mid:'test',text:'Список заказов'}}},{...event,message:{...event.message,recipient:{chat_type:'chat'}}},{...event,message:{...event.message,sender:{user_id:123,is_bot:true}}}])assert.equal(setupIdentity(patch),null);
});
test('only configured owner can request group ID, group orders stay ignored',()=>{
  const event={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'chat',chat_id:-456},body:{mid:'group-test',text:'/chatid'}}};
  assert.equal(setupIdentity(event,Date.now(),{MAX_OWNER_ID:'123'}).chatId,-456);
  assert.equal(setupIdentity(event,Date.now(),{MAX_OWNER_ID:'999'}),null);
  assert.equal(setupIdentity(event,Date.now(),{}),null);
  assert.equal(setupIdentity({...event,message:{...event.message,body:{mid:'group-order',text:'Принять заявку'}}},Date.now(),{MAX_OWNER_ID:'123'}),null);
});
test('work group is exact, unknown groups and invalid IDs are not admitted',()=>{
  const env={MAX_WORK_CHAT_ID:'-456'};
  assert.equal(workChatConfigured(env),true);assert.equal(workChatConfigured({MAX_WORK_CHAT_ID:'0'}),false);assert.equal(workChatConfigured({MAX_WORK_CHAT_ID:'-456junk'}),false);
  assert.equal(isWorkChat({recipient:{chat_type:'chat',chat_id:-456}},env),true);
  assert.equal(isWorkChat({recipient:{chat_type:'chat',chat_id:-457}},env),false);
  assert.equal(isWorkChat({recipient:{chat_type:'dialog',chat_id:-456}},env),false);
});
test('status command admits only owner in private chat',()=>{
  const env={MAX_OWNER_ID:'123',MAX_WORK_CHAT_ID:'-456'};
  const e={update_type:'message_created',timestamp:Date.now(),message:{sender:{user_id:123},recipient:{chat_type:'chat',chat_id:-456},body:{mid:'status',text:'/status'}}};
  assert.equal(setupIdentity(e,Date.now(),env),null);
  assert.equal(setupIdentity({...e,message:{...e.message,recipient:{chat_type:'dialog',chat_id:456}}},Date.now(),env).kind,'status');
  assert.equal(setupIdentity({...e,message:{...e.message,recipient:{chat_type:'chat',chat_id:-789}}},Date.now(),env),null);
  assert.equal(setupIdentity({...e,message:{...e.message,sender:{user_id:999}}},Date.now(),env),null);
});
test('webhook rejects forged requests and sends only one self-ID acknowledgement',async()=>{
  let sends=0;const env={MAX_BOT_TOKEN:'secret'};
  const server=makeServer(env,async()=>({connected:true}),async(_token,path,body)=>{sends++;assert.equal(path,'/messages?user_id=123');assert.match(body.text,/Ваш ID в MAX: 123/);return {ok:true,data:{}};},{registered:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/max/webhook';
  const event={update_type:'bot_started',timestamp:Date.now(),user:{user_id:123}};
  const send=(secret,body=JSON.stringify(event))=>fetch(url,{method:'POST',headers:{'x-max-bot-api-secret':secret},body});
  try{
    assert.equal((await send('wrong')).status,403);assert.equal(sends,0);
    assert.equal((await send(webhookSecret('secret'),'x'.repeat(32769))).status,413);
    assert.equal((await send(webhookSecret('secret'))).status,200);assert.equal((await send(webhookSecret('secret'))).status,200);assert.equal(sends,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('certificate files are CA certificates and valid today',()=>{
  for(const name of ['russian-root.crt','russian-sub.crt']){
    const cert=new X509Certificate(readFileSync(new URL('./certs/'+name,import.meta.url)));
    assert.equal(cert.ca,true);assert.ok(new Date(cert.validFrom)<=new Date());assert.ok(new Date(cert.validTo)>new Date());
  }
});
test('public health does not call MAX; connection checks are cached and cannot write',async()=>{
  let count=0;const server=makeServer({MAX_BOT_TOKEN:'secret'},async()=>{count++;return {connected:true,username:EXPECTED_BOT};});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{
    const health=await (await fetch(base+'/health')).json();assert.equal(health.sheetsWrite,false);assert.equal(count,0);
    const values=await Promise.all([fetch(base+'/api/connection').then(r=>r.json()),fetch(base+'/api/connection').then(r=>r.json())]);
    assert.equal(count,1);assert.equal(values[0].connected,true);assert.equal(values[1].orderIntake,false);
    assert.equal((await fetch(base+'/api/connection',{method:'POST'})).status,405);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
