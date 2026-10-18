import https from 'node:https';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupSubscription,receiveSetup,ownerConfigured,workChatConfigured} from './setup.mjs';
import {bridgeConfigured,bridgeRequest} from './intake.mjs';

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

export function makeServer(env=process.env,probe=queryBot,api=maxApi,setupState={registered:false}){
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
    if(url.pathname==='/max/webhook'&&req.method==='POST'){
      try{return respond(await receiveSetup(req,env,api,seen,setupState),{received:true});}catch{return respond(503,{error:'unavailable'});}
    }
    if(req.method!=='GET')return respond(405,{error:'method-not-allowed'});
    const ready=bridgeConfigured(env)&&setupState.bridgeReady===true&&ownerConfigured(env)&&workChatConfigured(env)&&setupState.registered;
    const stage={service:'autosklad63-max',stage:ready?'owner-confirmed-intake':'workspace-bound',ownerConfigured:ownerConfigured(env),workChatConfigured:workChatConfigured(env),webhookRegistered:setupState.registered,orderIntake:ready,sheetsWrite:ready,confirmationRequired:true};
    if(url.pathname==='/health')return respond(200,stage);
    if(url.pathname==='/api/connection')return respond(200,{...stage,...await status()});
    if(url.pathname==='/'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      return res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><title>АвтоСклад63 — MAX</title><h1>Менеджер продаж MAX</h1><p>Первый этап: проверка подключения бота.</p><p><a href="/api/connection">Проверить подключение</a></p><p>Приём заявок и запись в таблицу ещё не подключены.</p></html>');
    }
    respond(404,{error:'not-found'});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||3000);
  const setupState={registered:false};
  makeServer(process.env,queryBot,maxApi,setupState).listen(port,'0.0.0.0',async()=>{
    console.log('MAX setup service started');
    const result=await setupSubscription(process.env,maxApi).catch(()=>({registered:false}));setupState.registered=result.registered;
    if(bridgeConfigured(process.env)){const check=await bridgeRequest(process.env,{action:'ping'});setupState.bridgeReady=Boolean(check.ok&&check.spreadsheetMatches);}
    console.log(result.registered?'MAX setup webhook registered':'MAX setup webhook not registered');
  });
}
