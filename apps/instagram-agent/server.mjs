import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { normalize, compose, sameSecret, verifySignature, canSend, outgoing } from './engine.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export function configuration(env = process.env) {
  return {host:env.HOST||'127.0.0.1',port:Number(env.PORT||8766),adminToken:env.ADMIN_TOKEN||'',secret:env.META_APP_SECRET||'',verifyToken:env.META_VERIFY_TOKEN||'',accountId:env.INSTAGRAM_ACCOUNT_ID||'',accessToken:env.INSTAGRAM_ACCESS_TOKEN||'',apiVersion:env.META_API_VERSION||'',allowSend:env.ALLOW_SEND==='true',autoReply:env.AUTO_REPLY==='true',dailyLimit:Math.max(1,Math.min(100,Number(env.DAILY_SEND_LIMIT)||30)),ollamaModel:env.OLLAMA_MODEL||''};
}

export function createAgent(config, {dataDir=path.join(root,'data'), fetcher=fetch, clock=()=>Date.now()} = {}) {
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  if (!config.adminToken) {
    const tokenFile=path.join(dataDir,'admin-token.txt');
    config.adminToken=fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():randomBytes(32).toString('hex');
    if (config.adminToken.length<32) throw Error('Admin token must be at least 32 characters');
    fs.writeFileSync(tokenFile,config.adminToken,{mode:0o600});
  } else if (config.adminToken.length<32) throw Error('Admin token must be at least 32 characters');
  const kb=JSON.parse(fs.readFileSync(path.join(root,'knowledge.json'),'utf8'));
  const db=path.join(dataDir,'state.json');
  let state=fs.existsSync(db)?JSON.parse(fs.readFileSync(db,'utf8')):{paused:false,events:[],threads:{},daily:{},sentIds:[]};
  const save=()=>{const temp=db+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,db);};
  // Never retry an ambiguous send after a crash. Verify it manually in Instagram.
  for(const e of state.events){if(e.status==='sending')e.status='uncertain';if(e.status==='processing')e.status='queued';}
  const retention=clock()-30*86400000;
  state.events=state.events.filter(e=>e.createdAt>retention);
  const active=new Set(state.events.map(e=>e.thread));
  for(const id of Object.keys(state.threads))if(!active.has(id))delete state.threads[id];
  state.sentIds=state.sentIds.slice(-3000);
  for(const day of Object.keys(state.daily))if(day<new Date(retention).toISOString().slice(0,10))delete state.daily[day];
  save();
  let chain=Promise.resolve();
  const serial=fn=>{const work=chain.then(fn);chain=work.catch(()=>{});return work;};
  const publicConfig=()=>({account:kb.account,metaReady:Boolean(config.secret&&config.verifyToken&&config.accountId&&config.accessToken&&/^v\d+\.\d+$/.test(config.apiVersion)),allowSend:config.allowSend,autoReply:config.autoReply,model:config.ollamaModel||null,paused:state.paused,dailyLimit:config.dailyLimit,todayCount:state.daily[new Date(clock()).toISOString().slice(0,10)]||0});
  function ingest(payload){
    let count=0;
    for(const event of normalize(payload,config.accountId,clock())){
      if(state.events.some(e=>e.id===event.id))continue;
      if(event.kind==='echo'){
        if(!state.sentIds.includes(event.mid)){
          state.threads[event.thread]={...state.threads[event.thread],paused:true};
          for(const e of state.events)if(e.thread===event.thread&&e.status==='draft')e.status='superseded';
        }
        continue;
      }
      const prev=state.threads[event.thread];
      const latest=state.events.find(e=>e.id===prev?.latest);
      if(event.kind==='dm'&&latest&&event.at<=latest.at){
        state.events.push({...event,status:'superseded',createdAt:clock()});continue;
      }
      for(const e of state.events)if(e.thread===event.thread&&e.status==='draft')e.status='superseded';
      state.threads[event.thread]={...prev,latest:event.id};
      state.events.push({...event,status:'queued',createdAt:clock()});count++;
    }
    save();return count;
  }
  async function send(event,text){
    const blocked=canSend(event,state,config,clock());
    if(blocked)throw Error(blocked);
    if(typeof text!=='string'||!text.trim()||text.length>1000)throw Error('Ответ должен содержать от 1 до 1000 символов');
    if(!/^\d+$/.test(config.accountId)||!/^\d+$/.test(event.recipient))throw Error('Неверный идентификатор Meta');
    const request=outgoing(event,text,config);
    event.status='sending';event.approvedText=text;
    const day=new Date(clock()).toISOString().slice(0,10);
    state.daily[day]=(state.daily[day]||0)+1;save();
    try{
      const res=await fetcher(request.url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.accessToken},body:JSON.stringify(request.body),signal:AbortSignal.timeout(15000)});
      if(!res.ok){event.status=res.status>=500?'uncertain':'failed';event.error=`Meta HTTP ${res.status}; повторная отправка автоматически не выполняется`;save();return;}
      const data=await res.json();
      const mid=data.message_id||data.id;
      if(!mid){event.status='uncertain';event.error='Meta не вернула идентификатор; проверьте Instagram вручную';save();return;}
      state.sentIds.push(String(mid));state.sentIds=state.sentIds.slice(-3000);
      event.status='sent';event.sentAt=clock();save();
    }catch{event.status='uncertain';event.error='Результат отправки неизвестен. Проверьте Instagram; автоматического повтора нет';save();}
  }
  async function processOne(){
    if(state.paused)return;
    const event=state.events.find(e=>e.status==='queued');
    if(!event)return;
    if(state.threads[event.thread]?.paused){event.status='handoff';event.reason='Диалог на паузе';save();return;}
    if(event.kind==='dm'&&state.threads[event.thread]?.latest!==event.id){event.status='superseded';save();return;}
    if(!event.at||event.at>clock()+60000||clock()-event.at>=86400000){event.status='expired';save();return;}
    event.status='processing';save();
    const history=state.events.filter(e=>e.thread===event.thread&&e.id!==event.id&&e.createdAt<event.createdAt);
    const draft=event.attachment?{text:'Вложение нужно просмотреть Антону.',needsHuman:true,reason:'Вложение',source:'handoff'}:await compose(event,kb,history,config,fetcher);
    Object.assign(event,{draft:draft.text,needsHuman:draft.needsHuman,source:draft.source,reason:draft.reason,status:'draft'});
    save();
    if(config.autoReply&&draft.source==='faq'&&!draft.needsHuman&&!event.simulated){
      const blocked=canSend(event,state,config,clock());
      if(!blocked)await send(event,event.draft);else{event.reason=blocked;save();}
    }
  }
  function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
  async function read(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>256000)throw Error('Слишком большой запрос');chunks.push(chunk);}return Buffer.concat(chunks);}
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    try{
      if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,app:'anton-instagram-agent'});
      if(url.pathname==='/webhook'&&req.method==='GET'){
        if(url.searchParams.get('hub.mode')==='subscribe'&&sameSecret(url.searchParams.get('hub.verify_token'),config.verifyToken)){
          res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end(url.searchParams.get('hub.challenge')||'');
        }return json(res,403,{error:'Verification failed'});
      }
      if(url.pathname==='/webhook'&&req.method==='POST'){
        const raw=await read(req);
        if(!verifySignature(raw,req.headers['x-hub-signature-256'],config.secret))return json(res,403,{error:'Invalid signature'});
        let payload;try{payload=JSON.parse(raw.toString('utf8'));}catch{return json(res,400,{error:'Invalid JSON'});}
        await serial(()=>ingest(payload));return json(res,200,{received:true});
      }
      if(url.pathname.startsWith('/api/')){
        if(!sameSecret(req.headers.authorization,'Bearer '+config.adminToken))return json(res,401,{error:'Введите ключ владельца'});
        if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{config:publicConfig(),events:state.events.slice(-100).reverse(),threads:state.threads,knowledge:kb});
        if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
        let body;try{body=JSON.parse((await read(req)).toString('utf8'));}catch{return json(res,400,{error:'Неверный JSON'});}
        const result=await serial(async()=>{
          if(url.pathname==='/api/simulate'){
            if(typeof body.text!=='string'||!body.text.trim()||body.text.length>3000)throw Error('Введите сообщение до 3000 символов');
            const id='test:'+randomUUID();const now=clock();
            state.events.push({id,kind:body.kind==='comment'?'comment':'dm',thread:id,recipient:'test',text:body.text,at:now,createdAt:now,status:'queued',simulated:true});save();
            // Process this exact simulated event even if inbox has older work.
            const event=state.events.at(-1);const draft=await compose(event,kb,[],config,fetcher);
            Object.assign(event,{status:'draft',draft:draft.text,needsHuman:draft.needsHuman,source:draft.source,reason:draft.reason});save();return {id};
          }
          if(url.pathname==='/api/pause'){
            if(typeof body.paused!=='boolean')throw Error('Неверное значение паузы');
            if(body.thread){if(!Object.hasOwn(state.threads,body.thread))throw Error('Диалог не найден');state.threads[body.thread].paused=body.paused;}
            else state.paused=body.paused;
            save();return {ok:true};
          }
          const event=state.events.find(e=>e.id===body.id);
          if(!event)throw Error('Событие не найдено');
          if(url.pathname==='/api/reject'){
            if(!['draft','handoff','queued'].includes(event.status))throw Error('Событие уже обработано');
            event.status='rejected';save();return {ok:true};
          }
          if(url.pathname==='/api/send'){await send(event,body.text);return {status:event.status};}
          throw Error('Действие не найдено');
        });return json(res,200,result);
      }
      if(req.method==='GET'&&url.pathname==='/'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(path.join(root,'dashboard.html')));
      }
      if(req.method==='GET'&&['/dashboard.js','/style.css'].includes(url.pathname)){
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','X-Content-Type-Options':'nosniff'});return res.end(fs.readFileSync(path.join(root,url.pathname.slice(1))));
      }
      return json(res,404,{error:'Not found'});
    }catch(error){if(!res.headersSent)json(res,400,{error:error.message?.startsWith('Meta')?'Ошибка Meta':error.message||'Ошибка обработки'});else res.end();}
  });
  server.headersTimeout=10000;server.requestTimeout=60000;
  const timer=setInterval(()=>serial(processOne).catch(()=>console.error('Ошибка обработки очереди; проверьте состояние в панели')),1500);timer.unref();
  return {server,config,state,ingest:payload=>serial(()=>ingest(payload)),tick:()=>serial(processOne),close:async()=>{clearInterval(timer);await chain;await new Promise(resolve=>server.close(resolve));}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=configuration();
  const app=createAgent(config);
  app.server.listen(config.port,config.host,()=>console.log(`Панель: http://${config.host}:${config.port}/\nКлюч владельца: файл data/admin-token.txt (если ADMIN_TOKEN не задан в .env).\nРеальная отправка: ${config.allowSend?'разрешена':'выключена'}. Meta и ИИ требуют отдельной настройки.`));
  let closing=false;const stop=()=>{if(!closing){closing=true;app.close().then(()=>process.exit(0));}};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
