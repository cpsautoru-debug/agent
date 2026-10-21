// Owner-private Sites API; D1 journal and R2 media. Provider credentials stay on Render.
const backend='https://autosklad63-max.onrender.com/vk/office';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
const safeError=e=>/^(vk-|publishing-|community-|group-|post-|story-|unsafe-|photo-|capability-)/.test(e.message||'')?e.message:'operation-result-unknown';
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length<32||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export function createVkOffice({faq,kb,fetcher=fetch,now=Date.now}){
 return async function route(request,env){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/vk/'))return null;
  const action=url.pathname.slice('/api/vk/'.length);
  const service=equal(request.headers.get('Authorization')?.replace(/^Bearer /,''),env.VK_OFFICE_BRIDGE_KEY);
  const owner=Boolean(request.headers.get('oai-authenticated-user-id'));
  if(action==='event'?!service:!owner&&!service)return json({error:'forbidden'},403);
  if(request.method!=='GET'&&request.method!=='POST')return json({error:'method-not-allowed'},405);
  if(request.method==='POST'&&!service&&request.headers.get('Origin')!==url.origin)return json({error:'origin-forbidden'},403);
  if(!env.DB)return json({error:'persistent-storage-not-configured'},503);
  const db=env.DB;
  const first=id=>db.prepare('SELECT * FROM vk_records WHERE id=?').bind(id).first();
  const insert=(id,kind,state,payload)=>db.prepare('INSERT OR IGNORE INTO vk_records (id,kind,state,payload,created,updated) VALUES (?,?,?,?,?,?)').bind(id,kind,state,JSON.stringify(payload),now(),now()).run();
  const update=(id,state,payload)=>db.prepare('UPDATE vk_records SET state=?,payload=?,updated=? WHERE id=?').bind(state,JSON.stringify(payload),now(),id).run();
  const claim=(id,from)=>db.prepare('UPDATE vk_records SET state=?,updated=? WHERE id=? AND state=?').bind('processing',now(),id,from).run();
  const configured=async()=>{const r=await first('config');return r?JSON.parse(r.payload):{enabled:env.VK_AUTO_REPLIES==='true',since:Number(env.VK_ACTIVE_SINCE)||now()};};
  const call=async data=>{
   if(!env.VK_OFFICE_BRIDGE_KEY||env.VK_OFFICE_BRIDGE_KEY.length<32)throw Error('bridge-not-configured');
   let r;try{r=await fetcher(backend,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.VK_OFFICE_BRIDGE_KEY},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw Error('operation-result-unknown');}
   const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.error||'operation-result-unknown');return d;
  };
  const pausePeer=async peer=>{const id='peer-'+peer;await insert(id,'peer','paused',{paused:true});await update(id,'paused',{paused:true});};
  const parse=async()=>{
   const declared=Number(request.headers.get('Content-Length'));if(declared>9*1024*1024)throw Error('body-too-large');
   const reader=request.body?.getReader();if(!reader)throw Error('invalid-body');let size=0;const chunks=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>9*1024*1024){await reader.cancel();throw Error('body-too-large');}chunks.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length;}
   try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('invalid-body');}
  };
  try{
   if(action==='status'&&request.method==='GET'){
    const config=await configured();let capabilities;
    try{capabilities=await call({action:'status'});}catch(e){return json({ok:false,enabled:false,error:safeError(e),checkedAt:now()},503);}
    return json({ok:true,...capabilities,enabled:config.enabled===true&&capabilities.messages===true,checkedAt:now()});
   }
   if(action==='inbox'&&request.method==='GET'){
    const rows=await db.prepare('SELECT id,kind,state,payload,created,updated FROM vk_records WHERE kind IN (?,?,?) ORDER BY updated DESC LIMIT 50').bind('message','draft','reply').all();
    return json({ok:true,items:rows.results.map(r=>({...r,payload:JSON.parse(r.payload)}))});
   }
   if(action==='media'&&request.method==='GET'){
    const row=await first(url.searchParams.get('id'));if(row?.kind!=='draft'||!env.BUCKET)return json({error:'not-found'},404);
    const item=JSON.parse(row.payload),file=item.imageKey&&await env.BUCKET.get(item.imageKey);if(!file)return json({error:'not-found'},404);
    return new Response(file.body,{headers:{'Content-Type':item.imageType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
   }
   if(request.method!=='POST')return json({error:'not-found'},404);
   const data=await parse();
   if(action==='settings'){
    if(typeof data.enabled!=='boolean')return json({error:'invalid-settings'},400);
    if(data.enabled){const cap=await call({action:'status'});if(!cap.messages)return json({error:'messages-permission-required'},409);}
    const config={enabled:data.enabled,since:now()};await insert('config','config','configured',config);await update('config','configured',config);return json({ok:true,...config});
   }
   if(action==='pause'){
    if(!Number.isSafeInteger(data.peerId)||data.peerId<=0||data.peerId>=2000000000)return json({error:'invalid-peer'},400);
    await pausePeer(data.peerId);return json({ok:true});
   }
   if(action==='event'){
    const m=data.object?.message;
    if(data.type!=='message_new'||String(data.group_id)!==env.VK_GROUP_ID||!m||m.out!==0||!Number.isSafeInteger(m.peer_id)||m.peer_id<=0||m.peer_id>=2000000000||m.from_id!==m.peer_id||typeof m.text!=='string'||m.text.length>3500||!Number.isSafeInteger(m.date)||Math.abs(now()-m.date*1000)>300000)return json({ok:true,ignored:true});
    const mid=m.conversation_message_id||m.id;if(!Number.isSafeInteger(mid)||mid<=0)return json({ok:true,ignored:true});
    const id='m-'+data.group_id+'-'+m.peer_id+'-'+mid,config=await configured();
    if(m.date*1000<config.since)return json({ok:true,ignored:true});
    // A crashed holder leaves this peer closed for manual review, never auto-unlocks.
    const lockId='lock-'+m.peer_id,holder=crypto.randomUUID();
    await insert(lockId,'lock','free',{});
    const locked=await db.prepare('UPDATE vk_records SET state=?,updated=? WHERE id=? AND state=?').bind(holder,now(),lockId,'free').run();
    if(!locked.meta?.changes){
     await insert(id,'message','handoff',{peerId:m.peer_id,text:m.text,reason:'Параллельное сообщение — требуется владелец'});
     await pausePeer(m.peer_id);return json({ok:true,handoff:true});
    }
    try{
    const peer=await first('peer-'+m.peer_id),answer=faq(m.text,kb,'dm');
    const needsHuman=answer.needsHuman||!config.enabled||peer?.state==='paused'||Array.isArray(m.attachments)&&m.attachments.length>0;
    const payload={peerId:m.peer_id,text:m.text,answer:answer.text,reason:needsHuman?'Требуется владелец':'Ответ по базе компании'};
    const record=await insert(id,'message',needsHuman?'handoff':'processing',payload);
    if(!record.meta?.changes)return json({ok:true,duplicate:true});
    if(needsHuman){await pausePeer(m.peer_id);return json({ok:true,handoff:true});}
    try{const sent=await call({action:'reply',id,peerId:m.peer_id,text:answer.text});await update(id,'sent',{...payload,messageId:sent.messageId});}
    catch(e){await update(id,'unknown',{...payload,error:safeError(e)});await pausePeer(m.peer_id);}
    return json({ok:true});
    }finally{await db.prepare('UPDATE vk_records SET state=?,updated=? WHERE id=? AND state=?').bind('free',now(),lockId,holder).run();}
   }
   if(action==='reply'){
    if(!validId(data.id)||!validId(data.messageId)||typeof data.text!=='string'||!data.text.trim()||data.text.length>3500)return json({error:'invalid-reply'},400);
    const incoming=await first(data.messageId);if(incoming?.kind!=='message')return json({error:'message-not-found'},404);
    const original=JSON.parse(incoming.payload),payload={peerId:original.peerId,text:data.text,messageId:data.messageId};
    const r=await insert('reply-'+data.id,'reply','processing',payload);if(!r.meta?.changes)return json({error:'duplicate-operation'},409);
    await pausePeer(original.peerId);
    try{const sent=await call({action:'reply',id:'reply-'+data.id,peerId:original.peerId,text:data.text});await update('reply-'+data.id,'sent',{...payload,sent:sent.messageId});return json({ok:true});}
    catch(e){await update('reply-'+data.id,'unknown',{...payload,error:safeError(e)});return json({error:'operation-result-unknown'},502);}
   }
   if(action==='drafts'){
    if(!['post','story'].includes(data.kind)||typeof data.text!=='string'||!data.text.trim()||data.text.length>3500||data.checked!==true||data.rights!==true)return json({error:'invalid-draft'},400);
    const id=crypto.randomUUID(),payload={kind:data.kind,text:data.text,title:String(data.title||'Материал ВК').slice(0,120)};
    if(data.image){
     if(!env.BUCKET||!['image/png','image/jpeg'].includes(data.image.type)||typeof data.image.base64!=='string'||data.image.base64.length>8*1024*1024)return json({error:'image-storage-not-configured-or-invalid'},409);
     let bytes;try{bytes=Uint8Array.from(atob(data.image.base64),c=>c.charCodeAt(0));}catch{return json({error:'invalid-image'},400);}
     const valid=data.image.type==='image/png'?[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
     if(!valid||bytes.length<16||bytes.length>6*1024*1024)return json({error:'invalid-image'},400);
     payload.imageKey='vk/'+id;payload.imageType=data.image.type;await env.BUCKET.put(payload.imageKey,bytes,{httpMetadata:{contentType:payload.imageType}});
    }
    if(data.kind==='story'&&!payload.imageKey)return json({error:'story-image-required'},400);
    await insert(id,'draft','approved',payload);return json({ok:true,id});
   }
   if(action==='publish'){
    if(!validId(data.id))return json({error:'invalid-id'},400);
    const row=await first(data.id);if(row?.kind!=='draft')return json({error:'draft-not-found'},404);
    if(row.state!=='approved')return json({error:'already-attempted-check-provider'},409);
    const payload=JSON.parse(row.payload),cap=await call({action:'status'});
    if(!(payload.kind==='post'?cap.posts:cap.stories))return json({error:'capability-not-ready'},409);
    let image;
    if(payload.imageKey){
     const media=env.BUCKET&&await env.BUCKET.get(payload.imageKey);if(!media)return json({error:'image-not-found'},409);
     const bytes=new Uint8Array(await media.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
     image={type:payload.imageType,base64:btoa(binary)};
    }
    const lock=await claim(data.id,'approved');if(!lock.meta?.changes)return json({error:'duplicate-operation'},409);
    try{const sent=await call({action:'publish',id:data.id,kind:payload.kind,text:payload.text,...(image?{image}:{})});await update(data.id,'published',{...payload,url:sent.url,providerId:sent.id});return json({ok:true,url:sent.url});}
    catch(e){await update(data.id,'unknown',{...payload,error:safeError(e)});return json({error:'operation-result-unknown'},502);}
   }
   return json({error:'not-found'},404);
  }catch(e){return json({error:e.message==='body-too-large'?'too-large':'request-failed'},e.message==='body-too-large'?413:503);}
 };
}
