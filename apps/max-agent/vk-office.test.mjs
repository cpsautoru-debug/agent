import test from 'node:test';
import assert from 'node:assert/strict';
import {createVkClient,replyToVk,publishVk,diagnoseVk,handleVkOffice,forwardVkEvent} from './vk-office.mjs';
const env={VK_COMMUNITY_TOKEN:'community-fixture',VK_GROUP_ID:'123',VK_PUBLISH_TOKEN:'publishing-fixture'};
const response=data=>new Response(JSON.stringify({response:data}),{headers:{'Content-Type':'application/json'}});
test('VK API never places tokens in URLs, follows redirects or exposes provider error text',async()=>{
 let calls=0;
 const client=createVkClient(env,async(url,options)=>{
  calls++;assert.equal(url,'https://api.vk.com/method/groups.getById');assert.equal(options.redirect,'error');assert.equal(options.method,'POST');
  assert.equal(options.body.get('access_token'),env.VK_COMMUNITY_TOKEN);
  return new Response(JSON.stringify({error:{error_code:5,error_msg:'private fixture'}}));
 });
 await assert.rejects(client('groups.getById',{}),e=>e.message==='vk-api-5'&&!JSON.stringify(e).includes('private fixture'));
 assert.equal(calls,1);await assert.rejects(client('execute',{}));assert.equal(calls,1);
});
test('replies bind deterministic random_id to peer and operation; publishing requires separate token',async()=>{
 const calls=[];const api=async(method,params,kind)=>{calls.push({method,params,kind});return 17;};
 await replyToVk({peerId:456,text:'Ответ',id:'event-1'},env,api);await replyToVk({peerId:456,text:'Ответ',id:'event-1'},env,api);
 assert.equal(calls[0].params.random_id,calls[1].params.random_id);assert.equal(calls[0].params.peer_id,456);
 await assert.rejects(replyToVk({peerId:2000000001,text:'Ответ',id:'x'},env,api));
 await assert.rejects(publishVk({kind:'post',id:'p1',text:'Текст'},{...env,VK_PUBLISH_TOKEN:''},api));
});
test('post payload cannot choose another wall, identity or attachment owner',async()=>{
 const result=await publishVk({kind:'post',id:'p1',text:'Текст'},env,async(method,params,kind)=>{
  assert.equal(method,'wall.post');assert.equal(params.owner_id,-123);assert.equal(params.from_group,1);assert.equal(kind,'publish');return {post_id:8};
 });
 assert.equal(result.url,'https://vk.ru/wall-123_8');
});
test('diagnostics report missing publishing token rather than pretending all functions work',async()=>{
 const status=await diagnoseVk({...env,VK_PUBLISH_TOKEN:''},async(method)=>method==='groups.getById'?{groups:[{id:123,screen_name:'autosklad63'}]}:{permissions:[{name:'messages',setting:1}]});
 assert.equal(status.groupVerified,true);assert.equal(status.messages,true);assert.equal(status.posts,false);assert.equal(status.postsReason,'publishing-token-required');
});

test('office endpoint rejects anonymous requests before contacting provider',async()=>{
 let calls=0,status;const res={writeHead(code){status=code;},end(){}};
 await handleVkOffice({headers:{},method:'POST'},res,new URL('https://server.test/vk/office'),{...env,VK_OFFICE_BRIDGE_KEY:'x'.repeat(40)},async()=>{calls++;});
 assert.equal(status,403);assert.equal(calls,0);
});

test('provider upload URL cannot redirect credentials or image data to arbitrary hosts',async()=>{
 let calls=0;const image={type:'image/png',base64:Buffer.from([137,80,78,71,13,10,26,10,...Array(12).fill(0)]).toString('base64')};
 await assert.rejects(publishVk({kind:'story',id:'s1',image},env,async()=>({upload_url:'https://evil.test/image'}),async()=>{calls++;}),/unsafe-upload-url/);
 assert.equal(calls,0);
});

test('callback relay uses fixed private site and two separate server credentials',async()=>{
 const configured={VK_OFFICE_BRIDGE_KEY:'x'.repeat(40),VK_OFFICE_SERVICE_TOKEN:'service-fixture'};
 assert.equal(await forwardVkEvent({type:'message_new'},configured,async(url,options)=>{
  assert.equal(url,'https://autosklad63-office.sunsetbear9.chatgpt.site/api/vk/event');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+configured.VK_OFFICE_BRIDGE_KEY);
  assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer service-fixture');return Response.json({ok:true});
 }),true);
});
