import { faq, normalize, sameSecret, verifySignature } from '../engine.mjs';
import kb from '../knowledge.json' with { type: 'json' };
import privacy from './privacy.mjs';
import {createHash} from 'node:crypto';
import {outgoing} from '../engine.mjs';
import {panelHtml, panelCss, panelJs} from './panel.mjs';

export const revision = text => createHash('sha256').update(text).digest('hex');
export function metaError(data) {
  const e=data?.error||{};
  return {code:Number.isInteger(e.code)?e.code:null,subcode:Number.isInteger(e.error_subcode)?e.error_subcode:null};
}
export function sendBlock(event,env,now=Date.now()) {
  if(env.ALLOW_SEND!=='true'||!env.INSTAGRAM_ACCESS_TOKEN||!/^v\d+\.\d+$/.test(env.META_API_VERSION||'')) return 'Отправка ещё не подключена';
  if(event.kind!=='dm'&&event.kind!=='comment') return 'Неподдерживаемое обращение';
  if(!event.at||now-event.at>=86400000||event.at>now+60000) return 'Истекло время ответа. Откройте Instagram вручную';
  if(!/^\d+$/.test(event.recipient||'')||!/^\d+$/.test(env.INSTAGRAM_ACCOUNT_ID||'')) return 'Неверный идентификатор аккаунта';
  return null;
}
export function autoEligible(e,env,now=Date.now()) {
  const since=Number(env.AUTO_REPLY_SINCE);
  if(env.AUTO_REPLY!=='true'||!Number.isFinite(since)||since<=0||e.at<since||e.createdAt<since)return false;
  if(e.kind!=='dm'||e.status!=='draft'||e.attachment||e.needsHuman||e.source!=='faq'||e.updatedAt)return false;
  if(now-e.at>120000||e.at>now+60000)return false;
  const checked=faq(e.text,kb,'dm');
  return checked.source==='faq'&&!checked.needsHuman&&checked.text===e.draft&&e.draft.length<=1000;
}
async function action(request,env,url,automatic=false) {
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'Недопустимый источник запроса'},403);
  let input;try{input=JSON.parse(new TextDecoder().decode(await boundedBody(request,16384)));}catch{return reply({error:'Неверный запрос'},400);}
  if(!['save','handoff','reject','send'].includes(input.action)||typeof input.id!=='string')return reply({error:'Неизвестное действие'},400);
  const row=await env.DB.prepare('SELECT payload FROM events WHERE id = ? AND created_at >= ?').bind(input.id,Date.now()-30*86400000).first();
  if(!row)return reply({error:'Обращение не найдено'},404);
  const e=JSON.parse(row.payload);
  if(e.status!=='draft'||revision(row.payload)!==input.expected)return reply({error:'Обращение изменилось. Обновите список'},409);
  if(typeof input.text!=='string'||!input.text.trim()||input.text.length>1000)return reply({error:'Ответ должен содержать от 1 до 1000 символов'},400);
  const now=Date.now();
  if(automatic&&!autoEligible(e,env,now))return reply({error:'Требуется проверка владельца'},409);
  e.draft=input.text.trim();e.updatedAt=now;
  if(input.action==='send'){
    const blocked=sendBlock(e,env,now);if(blocked)return reply({error:blocked},409);
    e.status='sending';e.approvedText=e.draft;e.attemptAt=now;e.approvalMode=automatic?'automatic-faq':'owner';
  }else if(input.action==='handoff')e.status='handoff';else if(input.action==='reject')e.status='rejected';
  const changed=JSON.stringify(e);
  // A single conditional UPDATE claims the message, serializes the daily limit and rejects stale drafts.
  let guard=input.action==='send' ? " AND NOT EXISTS (SELECT 1 FROM events other WHERE other.thread=events.thread AND other.id<>events.id AND other.event_at>=events.event_at) AND (SELECT count(*) FROM events attempts WHERE json_extract(attempts.payload,'$.attemptAt')>=?)<30" : '';
  if(automatic)guard+=" AND NOT EXISTS (SELECT 1 FROM events p WHERE p.thread=events.thread AND (p.status='handoff' OR (p.status='draft' AND json_extract(p.payload,'$.needsHuman')=1) OR (p.kind='echo' AND NOT EXISTS (SELECT 1 FROM events s WHERE json_extract(s.payload,'$.sentMid')=json_extract(p.payload,'$.mid')))))";
  const args=[changed,e.status,e.id,row.payload];if(input.action==='send')args.push(Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z'));
  const claim=await env.DB.prepare('UPDATE events SET payload=?,status=? WHERE id=? AND payload=?'+guard).bind(...args).run();
  if(claim.meta.changes!==1)return reply({error:'Есть новое сообщение, ручной ответ или достигнут дневной лимит. Обновите список'},409);
  if(input.action!=='send')return reply({ok:true});
  const target=outgoing(e,e.approvedText,{accountId:env.INSTAGRAM_ACCOUNT_ID,apiVersion:env.META_API_VERSION});
  try{
    const r=await fetch(target.url,{method:'POST',headers:{Authorization:'Bearer '+env.INSTAGRAM_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(target.body),signal:AbortSignal.timeout(15000)});
    if(!r.ok){let info;try{info=metaError(await r.json());}catch{info={};}e.status=r.status>=500?'uncertain':'failed';e.metaError=info;e.error='Meta HTTP '+r.status+(info.code?' (код '+info.code+(info.subcode?', подкод '+info.subcode:'')+')':'')+'. Автоматического повтора нет';}
    else{const data=await r.json();const mid=data.message_id||data.id;e.status=mid?'sent':'uncertain';if(mid){e.sentMid=String(mid);e.sentAt=Date.now();}else e.error='Meta не подтвердила доставку. Проверьте Instagram';}
  }catch{e.status='uncertain';e.error='Результат отправки неизвестен. Проверьте Instagram; повтор выключен';}
  // If this write fails, the durable 'sending' claim still prevents another attempt.
  await env.DB.prepare('UPDATE events SET payload=?,status=? WHERE id=? AND payload=?').bind(JSON.stringify(e),e.status,e.id,changed).run();
  return reply({ok:true,status:e.status});
}

export async function autoProcess(ids,env,url) {
  if(env.AUTO_REPLY!=='true')return;
  for(const id of ids){
    try{
      const row=await env.DB.prepare('SELECT payload FROM events WHERE id=?').bind(id).first();
      if(!row)continue;const e=JSON.parse(row.payload);
      if(!autoEligible(e,env))continue;
      const request=new Request(url.origin+'/api/draft-action',{method:'POST',body:JSON.stringify({id:e.id,expected:revision(row.payload),action:'send',text:e.draft})});
      await action(request,env,url,true);
    }catch{/* Keep durable draft/sending state. Never retry an ambiguous send. */}
  }
}

const reply = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
export async function boundedBody(request, limit = 262144) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let length = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw Error('too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return bytes;
}
export function draftRows(payload, accountId, now = Date.now()) {
  return normalize(payload, accountId, now).map(event => {
    if (event.kind === 'echo') return {...event, text:'', status:'manual_echo', createdAt:now};
    const expired = !event.at || event.at > now + 60000 || now - event.at >= 86400000;
    const draft = event.attachment
      ? {text:'Вложение нужно просмотреть Антону.', needsHuman:true, source:'handoff', reason:'Вложение'}
      : faq(event.text, kb, event.kind);
    return {...event, status:expired ? 'expired' : 'draft', draft:draft.text,
      needsHuman:draft.needsHuman, source:draft.source, reason:draft.reason, createdAt:now};
  });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if(request.method==='GET'&&['/panel','/panel.js','/panel.css'].includes(url.pathname)){
      const [body,type]=url.pathname==='/panel'?[panelHtml,'text/html']:url.pathname==='/panel.js'?[panelJs,'text/javascript']:[panelCss,'text/css'];
      return new Response(body,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"}});
    }
    if (url.pathname === '/privacy' && (request.method === 'GET' || request.method === 'HEAD')) return new Response(request.method === 'HEAD' ? null : privacy, {headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
    if (url.pathname === '/health') return reply({service:'autosklad63-instagram', mode:'draft-only'});
    if (url.pathname === '/webhook' && request.method === 'GET') {
      if (!env.META_VERIFY_TOKEN) return reply({error:'not configured'},503);
      if (url.searchParams.get('hub.mode') === 'subscribe' && sameSecret(url.searchParams.get('hub.verify_token'),env.META_VERIFY_TOKEN)) {
        return new Response(url.searchParams.get('hub.challenge') || '',{headers:{'Cache-Control':'no-store'}});
      }
      return reply({error:'forbidden'},403);
    }
    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!env.DB || !env.META_APP_SECRET || !env.INSTAGRAM_ACCOUNT_ID) return reply({error:'not configured'},503);
      let raw; try {raw = await boundedBody(request);} catch {return reply({error:'too large'},413);}
      if (!verifySignature(raw,request.headers.get('x-hub-signature-256'),env.META_APP_SECRET)) return reply({error:'forbidden'},403);
      let payload; try {payload = JSON.parse(new TextDecoder().decode(raw));} catch {return reply({error:'invalid JSON'},400);}
      const rows = draftRows(payload,env.INSTAGRAM_ACCOUNT_ID);
      // Reject the whole delivery rather than acknowledging and losing part of a large batch.
      if (rows.length > 50) return reply({error:'batch too large'},413);
      try {
        if (rows.length) await env.DB.batch(rows.map(e => env.DB.prepare(
          'INSERT OR IGNORE INTO events (id,thread,kind,event_at,created_at,status,payload) VALUES (?,?,?,?,?,?,?)'
        ).bind(e.id,e.thread,e.kind,e.at,e.createdAt,e.status,JSON.stringify(e))));
        if(env.AUTO_REPLY==='true'){
          const work=autoProcess(rows.map(e=>e.id),env,url);
          if(ctx?.waitUntil)ctx.waitUntil(work);else await work;
        }
        return reply({received:true});
      } catch {return reply({error:'storage unavailable'},503);}
    }
    if (url.pathname.startsWith('/api/')) {
      if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || !sameSecret(request.headers.get('authorization'),'Bearer '+env.ADMIN_TOKEN)) return reply({error:'unauthorized'},401);
      if (!env.DB) return reply({error:'not configured'},503);
      try {
        if(url.pathname==='/api/connection'&&request.method==='GET'){
          if(!env.INSTAGRAM_ACCESS_TOKEN||!/^v\d+\.\d+$/.test(env.META_API_VERSION||''))return reply({connected:false,reason:'missing configuration'});
          const r=await fetch('https://graph.instagram.com/'+env.META_API_VERSION+'/me?fields=user_id,username',{headers:{Authorization:'Bearer '+env.INSTAGRAM_ACCESS_TOKEN},signal:AbortSignal.timeout(10000)});
          let data;try{data=await r.json();}catch{return reply({connected:false,http:r.status,reason:'invalid response'});}
          if(!r.ok)return reply({connected:false,http:r.status,...metaError(data)});
          const accountMatches=String(data.user_id||'')===env.INSTAGRAM_ACCOUNT_ID;
          return reply({connected:accountMatches,http:r.status,accountMatches});
        }
        if(url.pathname==='/api/draft-action'&&request.method==='POST')return await action(request,env,url);
        if(url.pathname!=='/api/drafts'||request.method!=='GET')return reply({error:'not found'},404);
        const data = await env.DB.prepare('SELECT payload FROM events WHERE created_at >= ? ORDER BY event_at DESC, id DESC LIMIT 100').bind(Date.now()-30*86400000).all();
        const allowSend=env.ALLOW_SEND==='true'&&Boolean(env.INSTAGRAM_ACCESS_TOKEN)&&/^v\d+\.\d+$/.test(env.META_API_VERSION||'');
        const autoReply=allowSend&&env.AUTO_REPLY==='true'&&Number(env.AUTO_REPLY_SINCE)>0;
        return reply({mode:autoReply?'auto-faq':allowSend?'manual':'draft-only',allowSend,autoReply, events:data.results.map(r=>({...JSON.parse(r.payload),revision:revision(r.payload)}))});
      } catch {return reply({error:'storage unavailable'},503);}
    }
    return reply({error:'not found'},404);
  },
  async scheduled(_event, env) {
    // Erase inbox content after 30 days. Only request errors are logged by the runtime.
    await env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(Date.now()-30*86400000).run();
  }
};
