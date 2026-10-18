// MAX setup diagnostics only. Order intake and Sheets writes are not enabled yet.
import {sameSecret} from '../engine.mjs';
const API='https://platform-api2.max.ru';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function maxRoute(request,env,url){
  if(url.pathname==='/max/health'&&request.method==='GET')return json({service:'autosklad63-max',stage:'setup-only',orderIntake:false,sheetsWrite:false});
  if(url.pathname!=='/api/max/connection')return null;
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||!sameSecret(request.headers.get('authorization'),'Bearer '+env.ADMIN_TOKEN))return json({error:'unauthorized'},401);
  if(request.method!=='GET')return json({error:'method not allowed'},405);
  if(!env.MAX_BOT_TOKEN)return json({connected:false,reason:'MAX_BOT_TOKEN missing',orderIntake:false,sheetsWrite:false});
  try{
    const result=await fetch(API+'/me',{headers:{Authorization:env.MAX_BOT_TOKEN},signal:AbortSignal.timeout(10000)});
    if(!result.ok)return json({connected:false,configured:true,http:result.status,reason:result.status===526?'TLS trust blocked; token validity unknown':'MAX rejected connection'});
    const bot=await result.json();
    const matches=bot.is_bot===true&&bot.username==='id632135065259_2_bot';
    return json({connected:matches,accountMatches:matches,username:matches?bot.username:undefined,orderIntake:false,sheetsWrite:false});
  }catch{return json({connected:false,reason:'MAX unavailable'});}
}
