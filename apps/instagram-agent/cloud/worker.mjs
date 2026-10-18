import { faq, normalize, sameSecret, verifySignature } from '../engine.mjs';
import kb from '../knowledge.json' with { type: 'json' };

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
  async fetch(request, env) {
    const url = new URL(request.url);
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
        return reply({received:true});
      } catch {return reply({error:'storage unavailable'},503);}
    }
    if (url.pathname === '/api/drafts' && request.method === 'GET') {
      if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || !sameSecret(request.headers.get('authorization'),'Bearer '+env.ADMIN_TOKEN)) return reply({error:'unauthorized'},401);
      if (!env.DB) return reply({error:'not configured'},503);
      try {
        const data = await env.DB.prepare('SELECT payload FROM events WHERE created_at >= ? ORDER BY event_at DESC, id DESC LIMIT 100').bind(Date.now()-30*86400000).all();
        return reply({mode:'draft-only', events:data.results.map(r=>JSON.parse(r.payload))});
      } catch {return reply({error:'storage unavailable'},503);}
    }
    return reply({error:'not found'},404);
  },
  async scheduled(_event, env) {
    // Erase inbox content after 30 days. Only request errors are logged by the runtime.
    await env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(Date.now()-30*86400000).run();
  }
};
