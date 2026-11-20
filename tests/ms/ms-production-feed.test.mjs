import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createProductionFeedHandler,summarizeProductionFeed}=await import('../../functions/api/ms/production-feed.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const URL='https://autosklad63-office-staging.pages.dev/api/ms/production-feed';
const env={
  OFFICE_SESSION_SECRET:'synthetic-session-secret',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  MS_API_TOKEN:'synthetic-access-token',
  OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_authorized_users/);return{
    bind(sub,email){assert.equal(email,'owner@example.invalid');return{
      async first(){return sub==='owner-id'?{allowed:1}:null;}
    };}
  };}}
};
async function request(sub='owner-id'){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(URL,{headers});
}
test('owner gets last 20 production tasks in one read-only upstream GET',async()=>{
  let calls=0;
  const handler=createProductionFeedHandler(async(uri,opts)=>{
    calls++;
    assert.match(uri,/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/productiontask\?limit=20/);
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Accept,'application/json;charset=utf-8');
    assert.equal(opts.headers.Authorization,'Bearer synthetic-access-token');
    return new Response(JSON.stringify({meta:{size:740},
      rows:[{name:'00740',moment:'2026-11-20 01:28:00.000',updated:'2026-11-20 01:29:00.000'}]
    }),{status:200});
  });
  const response=await handler({request:await request(),env});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.code,'ms_production_feed_ok');
  assert.equal(data.totalAllTime,740);
  assert.equal(data.records[0].number,'00740');
  assert.equal(data.selection,'LATEST_20_BY_DOCUMENT_DATE_NOT_ACTIVE_TASKS');
  assert.equal(data.changedRecords,0);
  assert.equal(calls,1);
  assert.ok(!JSON.stringify(data).includes('synthetic-access-token'));
});
test('unauthenticated, non-owner, missing-token cannot contact MoySklad',async()=>{
  let calls=0;
  const handler=createProductionFeedHandler(async()=>{calls++;throw Error('unexpected upstream request');});
  for(const [sub,e,code] of [[null,env,401],['not-owner',env,403],['owner-id',{...env,MS_API_TOKEN:''},503]]){
    const response=await handler({request:await request(sub),env:e});
    assert.equal(response.status,code);
  }
  assert.equal(calls,0);
});
test('invalid upstream response cannot be displayed as valid metrics',()=>{
  assert.throws(()=>summarizeProductionFeed({meta:{size:740},rows:[{name:'00737'}]}));
  assert.throws(()=>summarizeProductionFeed({meta:{size:740},rows:Array.from({length:21},()=>({name:'00737',moment:'2026-11-20'}))}));
});
test('upstream failure returns only error code, no upstream body or secret',async()=>{
  const handler=createProductionFeedHandler(async()=>new Response('sensitive body synthetic-access-token',{status:400}));
  const r=await handler({request:await request(),env});
  assert.equal(r.status,502);
  const text=await r.text();
  assert.match(text,/ms_upstream_error/);
  assert.doesNotMatch(text,/synthetic-access-token/);
  assert.doesNotMatch(text,/sensitive body/);
});
