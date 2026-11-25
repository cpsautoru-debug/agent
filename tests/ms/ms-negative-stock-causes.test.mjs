import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createNegativeCausesAudit}=await import('../../functions/api/ms/negative-stock-causes.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ENDPOINT='https://autosklad63-office-staging.pages.dev/api/ms/negative-stock-causes';
const OWNER='owner-id';
const secret='synthetic-session-secret';
const token='synthetic-moysklad-token';
const lipuchka='cfd25ff1-1ac3-11f1-0a80-16a500223fe0';
const env={
  OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  MS_API_TOKEN:token,
  OZON_FINANCE_DB:{prepare(sql){
    assert.match(sql,/office_authorized_users/);
    return {bind(sub,email){
      assert.equal(sub,OWNER);assert.equal(email,'owner@example.invalid');
      return {async first(){return {allowed:1};}};
    }};
  }}
};
async function request(){
  const cookie=(await createSession(OWNER,secret)).split(';')[0];
  return new Request(ENDPOINT,{headers:{Cookie:cookie}});
}
const itemId=url=>new URL(url).searchParams.get('filter').split('/').pop();
const moveRow=(id,n)=>({
  assortment:{uom:{name:'м'}},
  store:{name:'Основной склад (Цех)',meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/store/10000000-0000-4000-8000-000000000001'}},
  operation:{meta:{type:n%2?'supply':'productionstagecompletion',
    href:'https://api.moysklad.ru/api/remap/1.2/entity/supply/'+String(n).padStart(12,'0')},
    name:String(n).padStart(5,'0'),moment:'2026-04-01 10:00:00.000'},
  quantity:n%2?1.25:5
});

test('complete turnover journal follows pages, classifies document types, and stays GET-only',async()=>{
  const urls=[];
  const handler=createNegativeCausesAudit({fetcher:async(url,options)=>{
    urls.push(new URL(url));
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(new URL(url).pathname,'/api/remap/1.2/report/turnover/byoperations');
    const u=new URL(url),id=itemId(url),offset=Number(u.searchParams.get('offset'));
    assert.equal(u.searchParams.get('limit'),'1000');
    assert.equal(u.searchParams.get('momentFrom'),'2016-01-01 00:00:00');
    if(id!==lipuchka)return new Response(JSON.stringify({meta:{size:0,offset},rows:[]}),{status:200});
    const size=1001,count=Math.min(1000,size-offset);
    const rows=Array.from({length:count},(_,i)=>moveRow(id,offset+i+1));
    const meta={size,offset};
    if(offset===0){const next=new URL(u);next.searchParams.set('offset','1000');meta.nextHref=next.toString();}
    return new Response(JSON.stringify({meta,rows}),{status:200});
  }});
  const response=await handler({request:await request(),env});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.readOnly,true);
  assert.equal(body.changedRecords,0);
  assert.equal(body.allMovementPagesComplete,true);
  assert.equal(body.results.length,8);
  const result=body.results.find(x=>x.id===lipuchka);
  assert.equal(result.complete,true);
  assert.equal(result.documentCount,1001);
  assert.equal(result.readCount,1001);
  assert.equal(result.pages,2);
  assert.equal(result.period.from,'2016-01-01 00:00:00');
  assert.equal(result.countByCategory.receipt,501);
  assert.equal(result.countByCategory.production_consumption,500);
  assert.equal(result.documents[1].unit,'м');
  assert.equal(urls.length,9);
  assert.ok(urls.every(u=>u.searchParams.get('filter').startsWith('product=')));
  assert.doesNotMatch(JSON.stringify(body),/synthetic-moysklad-token/);
});

test('short page is marked incomplete and stops the remaining diagnostics',async()=>{
  let calls=0;
  const handler=createNegativeCausesAudit({fetcher:async(url,options)=>{
    calls++;assert.equal(options.method,'GET');
    return new Response(JSON.stringify({meta:{size:2,offset:0},rows:[moveRow('x',1)]}),{status:200});
  }});
  const response=await handler({request:await request(),env});
  const body=await response.json();
  assert.equal(body.allMovementPagesComplete,false);
  assert.equal(body.results.length,1);
  assert.equal(body.results[0].complete,false);
  assert.equal(body.results[0].status,'pagination_incomplete');
  assert.equal(calls,1);
});
