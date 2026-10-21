import {createHash,timingSafeEqual} from 'node:crypto';
const methods=new Set(['groups.getById','groups.getTokenPermissions','account.getAppPermissions','messages.send','wall.post','photos.getWallUploadServer','photos.saveWallPhoto','stories.getPhotoUploadServer','stories.save']);
const office='https://autosklad63-office.sunsetbear9.chatgpt.site';
const group=env=>{if(!/^[1-9]\d{0,11}$/.test(env.VK_GROUP_ID||''))throw Error('group-not-configured');return Number(env.VK_GROUP_ID);};
const textOK=s=>typeof s==='string'&&s.trim().length>0&&s.length<=3500;
const idOK=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const deterministic=s=>parseInt(createHash('sha256').update(s).digest('hex').slice(0,7),16)+1;
// One bounded provider queue per process; never retry a mutating operation blindly.
let providerQueue=Promise.resolve(),nextProviderCall=0;
function rateLimited(operation){
 const pending=providerQueue.then(async()=>{const delay=nextProviderCall-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));nextProviderCall=Date.now()+350;return operation();});
 providerQueue=pending.catch(()=>{});return pending;
}
export function createVkClient(env,fetcher=fetch){
 return async(method,params={},kind='community')=>{
  if(!methods.has(method))throw Error('method-forbidden');
  const token=kind==='publish'?env.VK_PUBLISH_TOKEN:env.VK_COMMUNITY_TOKEN;
  if(!token||/\s/.test(token))throw Error(kind==='publish'?'publishing-token-required':'community-token-required');
  const body=new URLSearchParams({...params,v:'5.199',access_token:token});
  let r;try{r=await rateLimited(()=>fetcher('https://api.vk.com/method/'+method,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(15000)}));}catch{throw Error('vk-network-unknown');}
  if(!r.ok)throw Error('vk-http-'+r.status);
  const raw=await r.text();if(raw.length>1024*1024)throw Error('vk-response-too-large');
  let data;try{data=JSON.parse(raw);}catch{throw Error('vk-invalid-response');}
  if(data.error)throw Error('vk-api-'+(Number.isInteger(data.error.error_code)?data.error.error_code:'unknown'));
  if(!Object.hasOwn(data,'response'))throw Error('vk-invalid-response');return data.response;
 };
}
export async function diagnoseVk(env,api=createVkClient(env)){
 const result={groupVerified:false,messages:false,posts:false,stories:false,postsReason:'publishing-token-required',storiesReason:'not-verified'};
 const g=group(env);
 const identity=await api('groups.getById',{group_id:g,fields:'can_post'});
 const record=(identity.groups||identity)?.[0];
 if(record?.id!==g||record.screen_name!=='autosklad63')throw Error('community-mismatch');
 result.groupVerified=true;
 try{const p=await api('groups.getTokenPermissions');result.messages=p.permissions?.some(x=>x.name==='messages'&&x.setting===1)===true;}catch{result.messages=false;}
 if(env.VK_PUBLISH_TOKEN){
  try{
   const [permissions,identity]=await Promise.all([api('account.getAppPermissions',{},'publish'),api('groups.getById',{group_id:g,fields:'can_post'},'publish')]);
   const own=(identity.groups||identity)?.[0];result.posts=(permissions&8192)!==0&&own?.id===g&&(own.can_post===1||own.is_admin===1);
   result.postsReason=result.posts?'permissions-verified':'publishing-permission-required';
  }catch(e){result.postsReason=e.message.startsWith('vk-')?e.message:'publishing-verification-failed';}
 }
 try{const upload=await api('stories.getPhotoUploadServer',{group_id:g,add_to_news:1});result.stories=Boolean(upload.upload_url);result.storiesReason=result.stories?'upload-permission-verified':'story-permission-required';}catch(e){result.storiesReason=e.message.startsWith('vk-')?e.message:'story-verification-failed';}
 return result;
}
export async function replyToVk(data,env,api=createVkClient(env)){
 if(!Number.isSafeInteger(data.peerId)||data.peerId<=0||data.peerId>=2000000000||!textOK(data.text)||!idOK(data.id))throw Error('invalid-reply');
 const messageId=await api('messages.send',{peer_id:data.peerId,message:data.text,random_id:deterministic(data.peerId+':'+data.id)});
 if(!Number.isSafeInteger(messageId)||messageId<=0)throw Error('vk-reply-result-unknown');return {messageId};
}
function imageFile(image){
 if(!image||!['image/png','image/jpeg'].includes(image.type)||typeof image.base64!=='string'||image.base64.length>8*1024*1024)throw Error('invalid-image');
 const bytes=Buffer.from(image.base64,'base64');
 const magic=image.type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!magic||bytes.length>6*1024*1024||bytes.length<16)throw Error('invalid-image');return new Blob([bytes],{type:image.type});
}
async function uploadImage(url,image,field,fetcher){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&parsed.port!=='443'||!['vk.com','vk.ru','vkuserphoto.ru','userapi.com'].some(domain=>parsed.hostname===domain||parsed.hostname.endsWith('.'+domain)))throw Error('unsafe-upload-url');
 const form=new FormData();form.set(field,imageFile(image),image.type==='image/png'?'image.png':'image.jpg');
 let r;try{r=await fetcher(parsed.href,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(25000)});}catch{throw Error('vk-upload-unknown');}
 if(!r.ok)throw Error('vk-upload-failed');const raw=await r.text();if(raw.length>1024*1024)throw Error('vk-upload-invalid');
 try{return JSON.parse(raw);}catch{throw Error('vk-upload-invalid');}
}
export async function publishVk(data,env,api=createVkClient(env),fetcher=fetch){
 const g=group(env);if(!idOK(data.id)||!['post','story'].includes(data.kind))throw Error('invalid-publication');
 if(data.kind==='post'){
  if(!env.VK_PUBLISH_TOKEN)throw Error('publishing-token-required');
  if(!textOK(data.text))throw Error('invalid-post');let attachments;
  if(data.image){
   const server=await api('photos.getWallUploadServer',{group_id:g},'publish');
   const uploaded=await uploadImage(server.upload_url,data.image,'photo',fetcher);
   const saved=await api('photos.saveWallPhoto',{group_id:g,photo:uploaded.photo,server:uploaded.server,hash:uploaded.hash},'publish');
   if(!saved?.[0]?.id||Number(saved[0].owner_id)!==-g)throw Error('photo-owner-mismatch');attachments='photo'+saved[0].owner_id+'_'+saved[0].id;
  }
  const result=await api('wall.post',{owner_id:-g,from_group:1,message:data.text,...(attachments?{attachments}:{}),guid:createHash('sha256').update(data.id).digest('hex').slice(0,16)},'publish');
  if(!Number.isSafeInteger(result.post_id)||result.post_id<=0)throw Error('post-result-unknown');return {id:result.post_id,url:'https://vk.ru/wall-'+g+'_'+result.post_id};
 }
 imageFile(data.image);
 const server=await api('stories.getPhotoUploadServer',{group_id:g,add_to_news:1});
 const uploaded=await uploadImage(server.upload_url,data.image,'file',fetcher);
 const uploadResult=uploaded.response?.upload_result;
 if(typeof uploadResult!=='string'||uploadResult.length>100000)throw Error('story-upload-result-unknown');
 const saved=await api('stories.save',{upload_results:uploadResult});
 const item=saved.items?.[0];if(!Number.isSafeInteger(item?.id)||Number(item.owner_id)!==-g)throw Error('story-result-unknown');
 return {id:item.id,url:'https://vk.ru/story-'+g+'_'+item.id};
}
const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length>=32&&x.length===y.length&&timingSafeEqual(x,y);};
export async function handleVkOffice(req,res,url,env,fetcher=fetch){
 if(url.pathname!=='/vk/office')return false;
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return true;};
 if(!same(env.VK_OFFICE_BRIDGE_KEY,String(req.headers.authorization||'').replace(/^Bearer /,'')))return send(403,{error:'forbidden'});
 if(req.method!=='POST')return send(405,{error:'method-not-allowed'});
 try{
  const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>9*1024*1024)return send(413,{error:'too-large'});chunks.push(Buffer.from(c));}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),api=createVkClient(env,fetcher);
  const capabilities=await diagnoseVk(env,api);
  if(data.action==='status')return send(200,{ok:true,...capabilities});
  if(data.action==='reply'&&capabilities.messages)return send(200,{ok:true,...await replyToVk(data,env,api)});
  if(data.action==='publish'&&(data.kind==='post'?capabilities.posts:data.kind==='story'&&capabilities.stories))return send(200,{ok:true,...await publishVk(data,env,api,fetcher)});
  return send(409,{error:'capability-not-ready'});
 }catch(e){const safe=/^(vk-|post-|story-|invalid-|unsafe-|photo-|group-|community-|publishing-)/.test(e.message)?e.message:'request-failed';return send(502,{error:safe});}
}
export async function forwardVkEvent(event,env,fetcher=fetch){
 if(!env.VK_OFFICE_SERVICE_TOKEN||!env.VK_OFFICE_BRIDGE_KEY)return false;
 const body=JSON.stringify(event);
 try{
  const r=await fetcher(office+'/api/vk/event',{method:'POST',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+env.VK_OFFICE_SERVICE_TOKEN,Authorization:'Bearer '+env.VK_OFFICE_BRIDGE_KEY},body,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)return false;const data=await r.json();return data.ok===true;
 }catch{return false;}
}
