import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createProductionFeedHandler,summarizeProductionFeed,parseProductionFeedScope,buildProductionFeedUrl}=await import('../../functions/api/ms/production-feed.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ENDPOINT='https://autosklad63-office-staging.pages.dev/api/ms/production-feed';
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
  return new Request(ENDPOINT,{headers});
}
test('owner gets last 5 production tasks in one read-only upstream GET',async()=>{
  let calls=0;
  const handler=createProductionFeedHandler(async(uri,opts)=>{
    calls++;
    assert.match(uri,/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/productiontask\?limit=5/);
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Accept,'application/json;charset=utf-8');
    assert.equal(opts.headers.Authorization,'Bearer synthetic-access-token');
    return new Response(JSON.stringify({meta:{size:740},
      rows:[{id:'009d69bb-8c9f-11f1-0a80-00480002f1cd',name:'00740',moment:'2026-11-20 01:28:00.000',updated:'2026-11-20 01:29:00.000',deliveryPlannedMoment:'2026-11-23 00:00:00.000',applicable:true}]
    }),{status:200});
  });
  const response=await handler({request:await request(),env});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.code,'ms_production_feed_ok');
  assert.equal(data.totalAllTime,740);
  assert.equal(data.records[0].number,'00740');
  assert.equal(data.records[0].plannedDate,'2026-11-23 00:00:00.000');
  assert.equal(data.records[0].documentPosted,true);
  assert.equal(data.offset,0);
  assert.equal(data.pageSize,5);
  assert.equal(data.hasMore,true);
  assert.equal(data.records[0].id,'009d69bb-8c9f-11f1-0a80-00480002f1cd');
  assert.equal(data.selection,'LATEST_5_BY_DOCUMENT_DATE_NOT_ACTIVE_TASKS');
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
  assert.throws(()=>summarizeProductionFeed({meta:{size:740},rows:Array.from({length:6},()=>({name:'00737',moment:'2026-11-20'}))}));
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

test('pagination scope accepts only offsets in steps of 5, capped safely',()=>{
  const good=parseProductionFeedScope(new URL(ENDPOINT+'?offset=10'));
  assert.deepEqual(good,{offset:10,number:null});
  const url=new URL(buildProductionFeedUrl(good));
  assert.equal(url.searchParams.get('offset'),'10');
  assert.equal(url.searchParams.get('limit'),'5');
  assert.equal(url.searchParams.get('order'),'moment,desc');
  assert.equal(summarizeProductionFeed({meta:{size:740},rows:[{
    name:'00731',moment:'2026-11-18 14:00:00'
  }]},good).hasPrevious,true);
  for(const bad of ['?offset=-5','?offset=2','?offset=5000','?offset=9999999','?offset=5&offset=10','?utm_source=chatgpt','?offset=0&number=00737']){
    assert.throws(()=>parseProductionFeedScope(new URL(ENDPOINT+bad)),bad);
  }
});
test('exact task-number search retains leading zeros and changes count meaning',()=>{
  const scope=parseProductionFeedScope(new URL(ENDPOINT+'?number=00737'));
  assert.deepEqual(scope,{offset:0,number:'00737'});
  const target=new URL(buildProductionFeedUrl(scope));
  assert.equal(target.searchParams.get('filter'),'name=00737');
  assert.equal(target.searchParams.get('limit'),'5');
  const summary=summarizeProductionFeed({meta:{size:1},rows:[{
    name:'00737',moment:'2026-11-19 23:53:00.000'
  }]},scope);
  assert.equal(summary.totalMatching,1);
  assert.equal(summary.totalAllTime,null);
  assert.equal(summary.selection,'EXACT_DOCUMENT_NUMBER_NOT_ACTIVE_TASKS');
  assert.equal(summary.hasMore,false);
  assert.equal(summary.searchNumber,'00737');
  for(const bad of ['?number=','?number=abc','?number=00737%3Bx%3D1','?number=00737&number=00738']){
    assert.throws(()=>parseProductionFeedScope(new URL(ENDPOINT+bad)),bad);
  }
});
test('owner can request only one restricted exact-number search query',async()=>{
  let calls=0;
  const handler=createProductionFeedHandler(async(uri,opts)=>{
    calls++;
    assert.equal(new URL(uri).searchParams.get('filter'),'name=00737');
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Authorization,'Bearer synthetic-access-token');
    return new Response(JSON.stringify({meta:{size:1},rows:[{
      name:'00737',moment:'2026-11-19 23:53:00.000'
    }]}),{status:200});
  });
  const response=await handler({request:await request('owner-id').then(r=>new Request(ENDPOINT+'?number=00737',{headers:r.headers})),env});
  assert.equal(response.status,200);
  assert.equal((await response.json()).totalMatching,1);
  assert.equal(calls,1);
});
test('invalid scope cannot contact upstream even from an owner session',async()=>{
  let count=0;
  const handler=createProductionFeedHandler(async()=>{count++;throw Error('unexpected');});
  const source=await request();
  const r=await handler({request:new Request(ENDPOINT+'?number=../delete',{headers:source.headers}),env});
  assert.equal(r.status,400);
  assert.equal(count,0);
});

test('updated production feed is explicitly requested and stays bounded to five',async()=>{
  const scope=parseProductionFeedScope(new URL(ENDPOINT+'?sort=updated&offset=5'));
  assert.deepEqual(scope,{offset:5,number:null,sort:'updated'});
  const url=new URL(buildProductionFeedUrl(scope));
  assert.equal(url.searchParams.get('order'),'updated,desc');
  assert.equal(url.searchParams.get('limit'),'5');
  const result=summarizeProductionFeed({
    meta:{size:740},rows:[{name:'00737',moment:'2026-10-01 12:00:00.000',
      updated:'2026-11-20 12:00:00.000'}]
  },scope);
  assert.equal(result.selection,'LATEST_5_BY_UPDATE_NOT_ACTIVE_TASKS');
  assert.equal(result.totalAllTime,740);
  assert.equal(result.records[0].updated,'2026-11-20 12:00:00.000');
  for(const s of [
    '?sort=moment','?sort=updated&sort=updated','?number=00737&sort=updated',
    '?sort=updated&offset=2','?sort=updated&all=true'
  ])assert.throws(()=>parseProductionFeedScope(new URL(ENDPOINT+s)),s);
});
