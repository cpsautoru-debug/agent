import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createMsProductionCheckHandler}=await import('../../functions/api/ms/production-check.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const URL='https://autosklad63-office-staging.pages.dev/api/ms/production-check';
const env={
  OFFICE_SESSION_SECRET:'synthetic-session-secret',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  MS_API_TOKEN:'synthetic-access-token',
  OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_authorized_users/);return {
    bind(sub,email){assert.equal(email,'owner@example.invalid');return {
      async first(){return sub==='owner-id'?{allowed:1}:null;}
    };}
  };}}
};
async function req(sub='owner-id'){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(URL,{headers});
}
test('owner: one read-only GET; token remains server-side',async()=>{
  let calls=0;
  const handler=createMsProductionCheckHandler(async(uri,opts)=>{
    calls++;assert.equal(opts.method,'GET');
    assert.match(uri,/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/productiontask\?/);
    assert.equal(opts.headers.Authorization,'Bearer synthetic-access-token');
    assert.equal(opts.redirect,'manual');
    return new Response(JSON.stringify({meta:{size:740},rows:[{id:'prod-uuid',name:'00737',moment:'2026-11-20 00:53:00'}]}),{status:200});
  });
  const res=await handler({request:await req(),env});
  assert.equal(res.status,200);
  const text=await res.text();
  assert.match(text,/ms_production_read_ok/);
  assert.match(text,/00737/);
  assert.doesNotMatch(text,/synthetic-access-token/);
  assert.equal(calls,1);
});
test('no call for anonymous, non-owner or invalid server configuration',async()=>{
  let calls=0;
  const handler=createMsProductionCheckHandler(async()=>{calls++;throw Error('should not fetch');});
  for(const [sub,settings,status] of [[null,env,401],['other-user',env,403],['owner-id',{...env,MS_API_TOKEN:''},503]]){
    const res=await handler({request:await req(sub),env:settings});
    assert.equal(res.status,status);
  }
  assert.equal(calls,0);
});
test('revoked token classified safely without including token in response',async()=>{
  const handler=createMsProductionCheckHandler(async()=>new Response('',{status:401}));
  const res=await handler({request:await req(),env});
  const text=await res.text();
  assert.match(text,/ms_token_rejected_or_revoked/);
  assert.doesNotMatch(text,/synthetic-access-token/);
});
