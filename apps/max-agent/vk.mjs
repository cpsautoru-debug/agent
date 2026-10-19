import {timingSafeEqual} from 'node:crypto';

const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);};
export function vkStatus(env){
  return {service:'autosklad63-vk',stage:'callback-setup',tokenConfigured:typeof env.VK_COMMUNITY_TOKEN==='string'&&env.VK_COMMUNITY_TOKEN.trim().length>=32,groupConfigured:/^\d+$/.test(env.VK_GROUP_ID||''),confirmationConfigured:Boolean(env.VK_CONFIRMATION_CODE),callbackSecretConfigured:typeof env.VK_CALLBACK_SECRET==='string'&&env.VK_CALLBACK_SECRET.length>=32,autoReplies:false,autoPosts:false};
}
export async function receiveVk(req,env){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>32768)return {code:413,text:'too-large'};chunks.push(Buffer.from(chunk));}
  let event;try{event=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return {code:400,text:'bad-request'};}
  if(!/^\d+$/.test(env.VK_GROUP_ID||'')||String(event?.group_id)!==env.VK_GROUP_ID)return {code:403,text:'forbidden'};
  if(event.type==='confirmation'){
    if(!env.VK_CONFIRMATION_CODE)return {code:503,text:'not-configured'};
    if(env.VK_CALLBACK_SECRET&&!equal(event.secret,env.VK_CALLBACK_SECRET))return {code:403,text:'forbidden'};
    return {code:200,text:env.VK_CONFIRMATION_CODE};
  }
  if(!vkStatus(env).callbackSecretConfigured||!equal(event.secret,env.VK_CALLBACK_SECRET))return {code:403,text:'forbidden'};
  // Connection stage only: acknowledge authenticated callbacks without storing private
  // conversations or sending replies. Publication and replies remain disabled.
  if(event.type==='message_new')console.log('VK authenticated message event received; replies disabled');
  return {code:200,text:'ok'};
}
