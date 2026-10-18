import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker, {draftRows,revision,sendBlock,autoEligible,autoProcess} from './worker.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
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
function database(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const DB={prepare(text){return {bind(...args){return {
    first:async()=>sql.prepare(text).get(...args),
    all:async()=>({results:sql.prepare(text).all(...args)}),
    run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})
  };}};}};
  const put=e=>sql.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(e.id,e.thread,e.kind,e.at,e.createdAt,e.status,JSON.stringify(e));
  return {sql,DB,put};
}
const admin='a'.repeat(64);
const callAction=(env,e,action,text='Проверенный ответ',expected=revision(JSON.stringify(e)))=>worker.fetch(new Request('https://example.com/api/draft-action',{method:'POST',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:JSON.stringify({id:e.id,expected,action,text})}),{ADMIN_TOKEN:admin,...env});
test('edit persists, stale edit conflicts, and handoff cannot be sent',async()=>{
  const d=database(),[e]=draftRows(payload,'123');d.put(e);
  assert.equal((await callAction(d,e,'save')).status,200);
  assert.equal((await callAction(d,e,'save')).status,409);
  const edited=JSON.parse(d.sql.prepare('SELECT payload FROM events').get().payload);
  assert.equal(edited.draft,'Проверенный ответ');
  assert.equal((await callAction(d,edited,'handoff')).status,200);
  const handed=JSON.parse(d.sql.prepare('SELECT payload FROM events').get().payload);
  assert.equal((await callAction(d,handed,'send')).status,409);d.sql.close();
});
test('panel serves no inbox data; API rejects unauthorized and cross-origin edits',async()=>{
  const panel=await worker.fetch(new Request('https://example.com/panel'),{});
  assert.equal(panel.status,200);assert.match(panel.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.doesNotMatch(await panel.text(),/Тест 2/);
  assert.equal((await worker.fetch(new Request('https://example.com/api/draft-action',{method:'POST'}),{})).status,401);
  const r=await worker.fetch(new Request('https://example.com/api/draft-action',{method:'POST',headers:{Authorization:'Bearer '+admin,Origin:'https://other.example'}}),{ADMIN_TOKEN:admin,DB:{}});
  assert.equal(r.status,403);
});
test('send guard refuses unconfigured or expired messages',()=>{
  const [e]=draftRows(payload,'123');assert.ok(sendBlock(e,{}));
  assert.ok(sendBlock(e,{ALLOW_SEND:'true',INSTAGRAM_ACCESS_TOKEN:'test',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'},now+86400001));
});
test('newer message and manual echo prevent sending an old draft',async()=>{
  const d=database(),[e]=draftRows(payload,'123');d.put(e);d.put({...e,id:'echo:new',at:e.at+1,kind:'echo',status:'manual_echo'});
  const env={DB:d.DB,ALLOW_SEND:'true',INSTAGRAM_ACCESS_TOKEN:'test',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'};
  assert.equal((await callAction(env,e,'send')).status,409);d.sql.close();
});
test('successful send is durable and double-click cannot send twice',async()=>{
  const d=database(),[e]=draftRows(payload,'123');d.put(e);let calls=0;
  const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({message_id:'m-out'});};
  try{
    const env={DB:d.DB,ALLOW_SEND:'true',INSTAGRAM_ACCESS_TOKEN:'test',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'};
    assert.equal((await callAction(env,e,'send')).status,200);
    assert.equal((await callAction(env,e,'send')).status,409);assert.equal(calls,1);
    assert.equal(d.sql.prepare('SELECT status FROM events').get().status,'sent');
  }finally{globalThis.fetch=old;d.sql.close();}
});
test('ambiguous send is recorded without automatic retry and daily cap is enforced',async()=>{
  const d=database(),[e]=draftRows(payload,'123');d.put(e);const old=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('timeout');};
  try{
    const env={DB:d.DB,ALLOW_SEND:'true',INSTAGRAM_ACCESS_TOKEN:'test',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'};
    assert.equal((await callAction(env,e,'send')).status,200);assert.equal(d.sql.prepare('SELECT status FROM events').get().status,'uncertain');
    for(let i=0;i<29;i++)d.put({...e,id:'attempt:'+i,thread:'other:'+i,status:'failed',attemptAt:Date.now()});
    const next={...e,id:'next',thread:'next'};d.put(next);assert.equal((await callAction(env,next,'send')).status,409);
  }finally{globalThis.fetch=old;d.sql.close();}
});
test('connection diagnostics redact Meta response and reject a different account',async()=>{
  const old=globalThis.fetch;
  const env={ADMIN_TOKEN:admin,DB:{},INSTAGRAM_ACCESS_TOKEN:'private-token',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'};
  const req=()=>new Request('https://example.com/api/connection',{headers:{Authorization:'Bearer '+admin}});
  try{
    globalThis.fetch=async()=>Response.json({error:{code:190,error_subcode:463,message:'private-token'}},{status:401});
    const bad=await (await worker.fetch(req(),env)).json();assert.equal(bad.code,190);assert.equal(bad.subcode,463);assert.doesNotMatch(JSON.stringify(bad),/private-token/);
    globalThis.fetch=async()=>Response.json({user_id:'999',username:'private-account'});
    const other=await (await worker.fetch(req(),env)).json();assert.equal(other.accountMatches,false);assert.equal(other.connected,false);
    globalThis.fetch=async()=>Response.json({user_id:'123'});
    assert.equal((await (await worker.fetch(req(),env)).json()).connected,true);
  }finally{globalThis.fetch=old;}
});
test('auto FAQ excludes backlog, edits, attachments, comments and unknown conditions',()=>{
  const now=Date.now(),[e]=draftRows({...payload,entry:[{...payload.entry[0],messaging:[{...payload.entry[0].messaging[0],timestamp:now}]}]},'123',now);
  const env={AUTO_REPLY:'true',AUTO_REPLY_SINCE:String(now-1000)};
  assert.equal(autoEligible(e,env,now),true);
  for(const patch of [{at:now-200000},{createdAt:now-200000},{updatedAt:now},{attachment:true},{kind:'comment'},{needsHuman:true},{draft:'Изменённый ответ'},{source:'model'}])assert.equal(autoEligible({...e,...patch},env,now),false);
  assert.equal(autoEligible(e,{AUTO_REPLY:'true'},now),false);
  assert.equal(autoEligible(e,{...env,AUTO_REPLY:'false'},now),false);
  const [unknown]=draftRows({object:'instagram',entry:[{id:'123',messaging:[{sender:{id:'456'},recipient:{id:'123'},timestamp:now,message:{mid:'discount',text:'Какая скидка дилерам?'}}]}]},'123',now);
  assert.equal(autoEligible(unknown,env,now),false);
});
test('auto FAQ sends only once and records automatic approval',async()=>{
  const d=database(),[e]=draftRows(payload,'123');d.put(e);const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({message_id:'auto1'});};
  try{
    const env={DB:d.DB,AUTO_REPLY:'true',AUTO_REPLY_SINCE:String(e.at-1),ALLOW_SEND:'true',INSTAGRAM_ACCESS_TOKEN:'test',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'};
    await autoProcess([e.id],env,new URL('https://example.com/webhook'));
    await autoProcess([e.id],env,new URL('https://example.com/webhook'));
    const out=JSON.parse(d.sql.prepare('SELECT payload FROM events').get().payload);
    assert.equal(out.status,'sent');assert.equal(out.approvalMode,'automatic-faq');assert.equal(calls,1);
  }finally{globalThis.fetch=old;d.sql.close();}
});
test('handoff or owner echo pauses auto FAQ; own outgoing echo does not pause it',async()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({message_id:'auto2'});};
  try{
    for(const pause of ['handoff','owner-echo','own-echo']){
      const d=database(),[e]=draftRows(payload,'123');d.put(e);
      const before={...e,id:'previous',at:e.at-1000,status:pause==='handoff'?'handoff':'manual_echo',kind:pause==='handoff'?'dm':'echo',mid:'previous-out'};d.put(before);
      if(pause==='own-echo')d.put({...e,id:'sent-before',at:e.at-2000,status:'sent',sentMid:'previous-out'});
      const env={DB:d.DB,AUTO_REPLY:'true',AUTO_REPLY_SINCE:String(e.at-1),ALLOW_SEND:'true',INSTAGRAM_ACCESS_TOKEN:'test',META_API_VERSION:'v26.0',INSTAGRAM_ACCOUNT_ID:'123'};
      await autoProcess([e.id],env,new URL('https://example.com/webhook'));
      assert.equal(d.sql.prepare('SELECT status FROM events WHERE id=?').get(e.id).status,pause==='own-echo'?'sent':'draft');d.sql.close();
    }
    assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
});
