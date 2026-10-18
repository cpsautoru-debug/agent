import https from 'node:https';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const EXPECTED_BOT='id632135065259_2_bot';
const certificates=['russian-root.crt','russian-sub.crt'].map(file=>readFileSync(new URL('./certs/'+file,import.meta.url),'utf8'));
export function queryBot(token,transport=https.request){
  return new Promise(resolve=>{
    let finished=false;
    const finish=value=>{if(!finished){finished=true;resolve(value);}};
    const req=transport('https://platform-api2.max.ru/me',{
      method:'GET',headers:{Authorization:token},ca:certificates,rejectUnauthorized:true,
    },res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{body+=chunk;if(body.length>65536){res.destroy();finish({connected:false,reason:'oversized-response'});}});
      res.on('error',()=>finish({connected:false,reason:'network-error'}));
      res.on('end',()=>{
        if(res.statusCode!==200)return finish({connected:false,http:res.statusCode,reason:'api-error'});
        try{
          const bot=JSON.parse(body);
          const matches=bot.is_bot===true&&bot.username===EXPECTED_BOT;
          finish({connected:matches,accountMatches:matches,...(matches?{username:EXPECTED_BOT}:{reason:'different-bot'})});
        }catch{finish({connected:false,reason:'invalid-response'});}
      });
    });
    req.setTimeout(10000,()=>{req.destroy();finish({connected:false,reason:'timeout'});});
    req.on('error',()=>finish({connected:false,reason:'tls-or-network-error'}));
    req.end();
  });
}

export function makeServer(env=process.env,probe=queryBot){
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
    if(req.method!=='GET')return respond(405,{error:'method-not-allowed'});
    const url=new URL(req.url,'http://localhost');
    const stage={service:'autosklad63-max',stage:'connection-test',orderIntake:false,sheetsWrite:false};
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
  makeServer().listen(port,'0.0.0.0',()=>console.log('MAX connection service started'));
}
