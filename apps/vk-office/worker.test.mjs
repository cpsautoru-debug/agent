import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createVkOffice} from './worker.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)||null;},
  async all(){return {results:db.prepare(sql).all(...values)};},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}
 };}};}};
 const env={DB,VK_GROUP_ID:'123',VK_OFFICE_BRIDGE_KEY:'x'.repeat(40),VK_AUTO_REPLIES:'true',VK_ACTIVE_SINCE:'1'};let sends=0;
 const handler=createVkOffice({faq:text=>text==='цена'?{text:'Подтверждённая цена',needsHuman:false}:{text:'Уточнит владелец',needsHuman:true},kb:{},fetcher:async(_url,options)=>{const d=JSON.parse(options.body);if(d.action==='reply'){sends++;return Response.json({ok:true,messageId:77});}return Response.json({ok:true,groupVerified:true,messages:true,posts:true,stories:true});}});
 const request=(path,body,service=false)=>new Request('https://office.test/api/vk/'+path,{method:body?'POST':'GET',headers:{...(service?{Authorization:'Bearer '+env.VK_OFFICE_BRIDGE_KEY}:{'oai-authenticated-user-id':'owner',Origin:'https://office.test'}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const event=(text,id=1)=>({group_id:123,type:'message_new',object:{message:{id,conversation_message_id:id,date:Math.floor(Date.now()/1000),from_id:456,peer_id:456,out:0,text}}});
 return {env,db,handler,request,event,sends:()=>sends,close:()=>db.close()};
}
test('private APIs require identity and same origin; event requires service secret',async()=>{
 const f=fixture();try{
  assert.equal((await f.handler(new Request('https://office.test/api/vk/status'),f.env)).status,403);
  assert.equal((await f.handler(f.request('event',f.event('цена')),f.env)).status,403);
  const r=new Request('https://office.test/api/vk/settings',{method:'POST',headers:{'oai-authenticated-user-id':'owner',Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});
  assert.equal((await f.handler(r,f.env)).status,403);assert.equal(f.sends(),0);
 }finally{f.close();}
});
test('durable duplicate claim sends once; unknown question pauses peer for owner',async()=>{
 const f=fixture();try{
  const send=e=>f.handler(f.request('event',e,true),f.env);
  assert.equal((await send(f.event('цена'))).status,200);await send(f.event('цена'));assert.equal(f.sends(),1);
  await send(f.event('неизвестно',2));await send(f.event('цена',3));assert.equal(f.sends(),1);
  const rows=f.db.prepare("SELECT state FROM vk_records WHERE kind='message' ORDER BY created,id").all();
  assert.equal(rows.filter(r=>r.state==='sent').length,1);assert.equal(rows.filter(r=>r.state==='handoff').length,2);
 }finally{f.close();}
});

test('concurrent handoff cannot be bypassed by a second FAQ callback',async()=>{
 const f=fixture();try{
  await Promise.all([f.handler(f.request('event',f.event('неизвестно',11),true),f.env),f.handler(f.request('event',f.event('цена',12),true),f.env)]);
  assert.equal(f.sends(),0);
 }finally{f.close();}
});
test('stale, outgoing, wrong group and group-chat events never send',async()=>{
 const f=fixture();try{
  for(const change of ['stale','out','group','peer']){const e=f.event('цена');if(change==='stale')e.object.message.date=1;if(change==='out')e.object.message.out=1;if(change==='group')e.group_id=999;if(change==='peer')e.object.message.peer_id=2000000001;await f.handler(f.request('event',e,true),f.env);}
  assert.equal(f.sends(),0);
 }finally{f.close();}
});
test('uncertain publication result cannot be replayed by a second click',async()=>{
 const f=fixture();let published=0;
 const handler=createVkOffice({faq:()=>({}),kb:{},fetcher:async(_u,o)=>{const d=JSON.parse(o.body);if(d.action==='publish'){published++;throw Error('connection lost after publication');}return Response.json({ok:true,posts:true,stories:true,messages:true,groupVerified:true});}});
 try{
  const time=Date.now();f.db.prepare('INSERT INTO vk_records VALUES (?,?,?,?,?,?)').run('draft-1','draft','approved',JSON.stringify({kind:'post',text:'Проверенный пост'}),time,time);
  const req=()=>f.request('publish',{id:'draft-1'});
  await handler(req(),f.env);await handler(req(),f.env);assert.equal(published,1);
  assert.equal(f.db.prepare('SELECT state FROM vk_records WHERE id=?').get('draft-1').state,'unknown');
 }finally{f.close();}
});
