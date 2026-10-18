import {createHmac,timingSafeEqual} from 'node:crypto';
const EXPECTED='id632135065259_2_bot';
export const webhookSecret=token=>createHmac('sha256',token).update('autosklad63/max/setup-webhook/v1').digest('hex');
export async function setupSubscription(env,api){
  if(!env.MAX_BOT_TOKEN||env.RENDER_EXTERNAL_URL!=='https://autosklad63-max.onrender.com')return {registered:false};
  const bot=await api(env.MAX_BOT_TOKEN,'/me');
  if(!bot.ok||bot.data?.username!==EXPECTED||bot.data?.is_bot!==true)return {registered:false};
  const url=env.RENDER_EXTERNAL_URL+'/max/webhook';
  const result=await api(env.MAX_BOT_TOKEN,'/subscriptions',{url,update_types:['bot_started','message_created'],secret:webhookSecret(env.MAX_BOT_TOKEN)});
  return {registered:Boolean(result.ok&&result.data?.success===true)};
}
export function setupIdentity(event,now=Date.now()){
  if(!Number.isFinite(event?.timestamp)||Math.abs(now-event.timestamp)>300000)return null;
  if(event.update_type==='bot_started'&&Number.isSafeInteger(event.user?.user_id)&&event.user.user_id>0&&!event.user.is_bot)return {user:event.user.user_id,id:'start:'+event.user.user_id+':'+event.timestamp};
  const m=event.message;
  if(event.update_type!=='message_created'||m?.recipient?.chat_type!=='dialog'||!Number.isSafeInteger(m.sender?.user_id)||m.sender.user_id<=0||m.sender.is_bot||typeof m.body?.mid!=='string')return null;
  if(!/^\/start(?:@[a-zA-Z0-9_]+)?\s*$/u.test(m.body.text||''))return null;
  return {user:m.sender.user_id,id:'message:'+m.body.mid};
}
export async function receiveSetup(req,env,api,seen,state){
  if(!env.MAX_BOT_TOKEN||!state.registered)return 503;
  const expected=Buffer.from(webhookSecret(env.MAX_BOT_TOKEN)),provided=Buffer.from(String(req.headers['x-max-bot-api-secret']||''));
  if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return 403;
  let raw='',size=0;
  for await(const chunk of req){size+=chunk.length;if(size>32768)return 413;raw+=chunk.toString();}
  let event;try{event=JSON.parse(raw);}catch{return 400;}
  const identity=setupIdentity(event);if(!identity)return 200;
  const now=Date.now();for(const [id,expires] of seen){if(expires<=now)seen.delete(id);}
  if(seen.has(identity.id)||seen.has('user:'+identity.user)||seen.size>1000)return 200;
  // Claim before sending. Only setup acknowledgements; no orders or persistent writes.
  seen.set(identity.id,now+3600000);seen.set('user:'+identity.user,now+60000);
  await api(env.MAX_BOT_TOKEN,'/messages?user_id='+identity.user,{text:'АвтоСклад63: соединение работает. Ваш ID в MAX: '+identity.user+'. Передайте этот ID Антону для настройки доступа. Приём заявок и запись в таблицу пока не включены.'});
  return 200;
}
