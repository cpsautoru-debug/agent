// Standalone staging entry point. Never imports production routes or Google Bridge.
import {createServer} from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {packingTest} from './packing-test.mjs';
import {maxApi} from './max-api.mjs';
export const packingSecret=token=>createHmac('sha256',token).update('autosklad63/packing-test/webhook/v1').digest('hex');
export function packingConfig(env){
 // Do not clone a production environment or attach its secret groups.
 if(Object.entries(env).some(([key,value])=>value&&(/^(?:MOYSKLAD_|VK_|INSTAGRAM_|META_|GOOGLE_|SHEETS_)/.test(key)||['MAX_BOT_TOKEN','MAX_OWNER_ID','MAX_WORK_CHAT_ID'].includes(key))))throw Error('production credentials forbidden');
 const token=env.MAX_TEST_BOT_TOKEN,username=env.MAX_TEST_BOT_USERNAME,owner=env.MAX_TEST_OWNER_ID,dir=env.MAX_PACKING_TEST_DIR,url=env.MAX_TEST_PUBLIC_URL;
 if(!token||!/^\w{3,80}$/.test(username||'')||username==='id632135065259_2_bot'||!/^\d+$/.test(owner||'')||!Number.isSafeInteger(Number(owner))||Number(owner)<=0||!dir||!isAbsolute(dir)||url!=='https://autosklad63-max-packing-test.onrender.com')throw Error('invalid packing test configuration');
 return Object.freeze({token,username,owner,dir,url});
}
export async function startPackingWebhook(config,api=maxApi,report=()=>{}){
 const fail=(code,result)=>{report(code,Number.isInteger(result?.http)?result.http:undefined);return false;};
 const bot=await api(config.token,'/me');
 if(!bot.ok)return fail('identity-api-error',bot);
 if(bot.data?.username!==config.username||bot.data?.username==='id632135065259_2_bot'||bot.data?.is_bot!==true)return fail('identity-mismatch');
 const subscriptions=await api(config.token,'/subscriptions');
 if(!subscriptions.ok)return fail('subscriptions-api-error',subscriptions);
 if(!Array.isArray(subscriptions.data?.subscriptions))return fail('subscriptions-invalid-response');
 if(subscriptions.data.subscriptions.some(s=>s.url!==config.url+'/max/webhook'))return fail('existing-subscription');
 const result=await api(config.token,'/subscriptions',{url:config.url+'/max/webhook',update_types:['message_created'],secret:packingSecret(config.token)});
 return result.ok===true&&result.data?.success===true?true:fail('registration-api-error',result);
}
export function makePackingServer(config,api=maxApi,state={registered:false}){
 const env={MAX_OWNER_ID:config.owner,MAX_PACKING_TEST_ENABLED:'true',MAX_PACKING_TEST_DIR:config.dir};
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(code)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({sandbox:true,ready:state.registered}));};
  if(req.method==='GET'&&req.url==='/health')return reply(state.registered?200:503);
  if(req.method!=='POST'||req.url!=='/max/webhook')return reply(404);
  if(!state.registered)return reply(503);
  const expected=Buffer.from(packingSecret(config.token)),supplied=Buffer.from(String(req.headers['x-max-bot-api-secret']||''));
  if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return reply(403);
  try{
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>32768)return reply(413);chunks.push(Buffer.from(chunk));}
   let event;try{event=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400);}
   const result=await packingTest(event,env);
   if(!result||result.ignored)return reply(200);
   const sent=await api(config.token,'/messages?user_id='+config.owner,{text:result.text});
   return reply(sent?.ok===true?200:503);
  }catch{return reply(503);}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const config=packingConfig(process.env),state={registered:false};
  // Verify the separate identity before publishing any callback URL.
  const server=makePackingServer(config,maxApi,state);
  server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{
   void startPackingWebhook(config,maxApi,(code,http)=>console.log('Packing setup: '+code+(http?' HTTP '+http:''))).then(registered=>{
    state.registered=registered;
    console.log(registered?'Packing sandbox ready; no business integrations':'Packing sandbox not ready; check separate identity and subscriptions');
   }).catch(()=>console.error('Packing sandbox registration unavailable'));
  });
  const stop=()=>server.close();process.once('SIGTERM',stop);process.once('SIGINT',stop);
 }catch{console.error('Packing sandbox refused startup; check test configuration and bot identity');process.exitCode=1;}
}
