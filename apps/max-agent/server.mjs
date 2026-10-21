import https from 'node:https';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupSubscription,receiveSetup,ownerConfigured,workChatConfigured} from './setup.mjs';
import {bridgeConfigured,bridgeRequest} from './intake.mjs';
import {vkStatus,receiveVk} from './vk.mjs';
import {createMoyskladClient,handleMoyskladRead} from './moysklad.mjs';
import {createStartupChecks} from './readiness.mjs';

export function startupChecks(env,state,api=maxApi,bridge=bridgeRequest,options){
  const checks=createStartupChecks({
    webhook:async()=>{
      if(!env.MAX_BOT_TOKEN||env.RENDER_EXTERNAL_URL!=='https://autosklad63-max.onrender.com')return {ok:false,terminal:true,code:'configuration-invalid'};
      let failure=null;
      const result=await setupSubscription(env,async(...args)=>{
        let value;
        try{value=await api(...args);}catch{failure={ok:false,terminal:args[1]==='/subscriptions',code:'unavailable'};return {ok:false};}
        if(!value.ok)failure={ok:false,terminal:[400,401,403,404].includes(value.http)||args[1]==='/subscriptions',code:[401,403].includes(value.http)?'unauthorized':'unavailable'};
        else if(args[1]==='/me'&&(value.data?.username!==EXPECTED_BOT||value.data?.is_bot!==true))failure={ok:false,terminal:true,code:'account-mismatch'};
        return value;
      });
      state.registered=result.registered===true;
      return state.registered?{ok:true}:failure||{ok:false,terminal:true,code:'invalid-response'};
    },
    bridge:async()=>{
      if(!bridgeConfigured(env))return {ok:false,terminal:true,code:'configuration-invalid'};
      const result=await bridge(env,{action:'ping'});
      state.bridgeReady=Boolean(result.ok&&result.spreadsheetMatches);
      return state.bridgeReady?{ok:true}:{ok:false,terminal:result.error==='unauthorized'||result.ok===true,code:result.error==='unauthorized'?'unauthorized':result.ok===true?'account-mismatch':'unavailable'};
    }
  },options);
  state.startup=checks;
  return checks;
}

export const EXPECTED_BOT='id632135065259_2_bot';
const certificates=['russian-root.crt','russian-sub.crt'].map(file=>readFileSync(new URL('./certs/'+file,import.meta.url),'utf8'));
export function maxApi(token,path='/me',body=null,transport=https.request){
  return new Promise(resolve=>{
    let finished=false;
    const finish=value=>{if(!finished){finished=true;resolve(value);}};
    const req=transport('https://platform-api2.max.ru'+path,{
      method:body?'POST':'GET',headers:{Authorization:token,...(body?{'Content-Type':'application/json'}:{})},ca:certificates,rejectUnauthorized:true,
    },res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{body+=chunk;if(body.length>65536){res.destroy();finish({connected:false,reason:'oversized-response'});}});
      res.on('error',()=>finish({connected:false,reason:'network-error'}));
      res.on('end',()=>{
        if(res.statusCode!==200)return finish({ok:false,http:res.statusCode,reason:'api-error'});
        try{
          finish({ok:true,data:JSON.parse(body)});
        }catch{finish({connected:false,reason:'invalid-response'});}
      });
    });
    req.setTimeout(10000,()=>{req.destroy();finish({connected:false,reason:'timeout'});});
    req.on('error',()=>finish({connected:false,reason:'tls-or-network-error'}));
    req.end(body?JSON.stringify(body):undefined);
  });
}
export async function queryBot(token,transport=https.request){
  const result=await maxApi(token,'/me',null,transport);
  if(!result.ok)return {connected:false,http:result.http,reason:result.reason};
  const matches=result.data.is_bot===true&&result.data.username===EXPECTED_BOT;
  return {connected:matches,accountMatches:matches,...(matches?{username:EXPECTED_BOT}:{reason:'different-bot'})};
}

export function makeServer(env=process.env,probe=queryBot,api=maxApi,setupState={registered:false},moyskladClient=createMoyskladClient()){
  const seen=new Map();
  let cached=null,pending=null,expires=0;
  const status=async()=>{
    if(!env.MAX_BOT_TOKEN)return {configured:false,connected:false,reason:'MAX_BOT_TOKEN missing'};
    if(cached&&Date.now()<expires)return cached;
    if(!pending)pending=Promise.resolve().then(()=>probe(env.MAX_BOT_TOKEN)).catch(()=>({connected:false,reason:'unavailable'})).then(value=>{
      cached={configured:true,...value};expires=Date.now()+30000;return cached;
    }).finally(()=>{pending=null;});
    return pending;
  };
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const respond=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    const url=new URL(req.url,'http://localhost');
    if(await handleMoyskladRead(req,res,url,env,moyskladClient))return;
    if(url.pathname==='/vk/webhook'&&req.method==='POST'){
      try{const result=await receiveVk(req,env);res.writeHead(result.code,{'Content-Type':'text/plain; charset=utf-8'});return res.end(result.text);}catch{return respond(503,{error:'unavailable'});}
    }
    if(url.pathname==='/max/webhook'&&req.method==='POST'){
      try{return respond(await receiveSetup(req,env,api,seen,setupState),{received:true});}catch{return respond(503,{error:'unavailable'});}
    }
    if(req.method!=='GET')return respond(405,{error:'method-not-allowed'});
    if(url.pathname==='/vk/health')return respond(200,vkStatus(env));
    const ready=bridgeConfigured(env)&&setupState.bridgeReady===true&&ownerConfigured(env)&&workChatConfigured(env)&&setupState.registered;
    const stage={service:'autosklad63-max',stage:ready?'owner-confirmed-intake':'workspace-bound',ownerConfigured:ownerConfigured(env),workChatConfigured:workChatConfigured(env),webhookRegistered:setupState.registered,orderIntake:ready,sheetsWrite:ready,confirmationRequired:true,intakeChannel:'owner-private-dialog'};
    if(url.pathname==='/health'||url.pathname==='/ready')return respond(url.pathname==='/ready'&&!ready?503:200,{...stage,liveness:true,readiness:ready,startup:setupState.startup?.snapshot()||{started:false,ready:false,checks:{}}});
    if(url.pathname==='/api/connection')return respond(200,{...stage,...await status()});
    if(url.pathname==='/'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      return res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>АвтоСклад63 — MAX</title><h1>Менеджер продаж MAX</h1><p><a href="/api/connection">Проверить подключение</a></p><p>'+(ready?'Приём заявок владельца подключён. Запись в таблицу — после подтверждения.':'Приём заявок пока не готов. Проверьте состояние запуска.')+'</p></html>');
    }
    respond(404,{error:'not-found'});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||3000);
  const setupState={registered:false};
  const checks=startupChecks(process.env,setupState);
  const server=makeServer(process.env,queryBot,maxApi,setupState);
  server.on('close',()=>checks.stop());
  const shutdown=()=>{checks.stop();server.close();};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  server.listen(port,'0.0.0.0',()=>{
    console.log('MAX setup service started');
    void checks.start();
  });
}
