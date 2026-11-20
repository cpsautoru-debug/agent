import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createProductionCoverageProbeHandler,summarizeProductionCoverageProbe}=
  await import('../../functions/api/ms/production-coverage-probe.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ENDPOINT='https://autosklad63-office-staging.pages.dev/api/ms/production-coverage-probe';
const taskId='009d69bb-8c9f-11f1-0a80-00480002f1cd';
const rowId='009d69bb-8c9f-11f1-0a80-00480002f1ce';
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
async function req(sub='owner-id',url=ENDPOINT){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(url,{headers});
}
const answer=(size,row)=>new Response(JSON.stringify({meta:{size},rows:size?[row]:[]}),{status:200});
test('owner probe makes exactly two sequential limited GETs and reports only counts/capability',async()=>{
  const urls=[];
  let active=0,peak=0;
  const handler=createProductionCoverageProbeHandler(async(uri,opts)=>{
    active++;peak=Math.max(peak,active);urls.push(uri);
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.headers.Authorization,'Bearer synthetic-access-token');
    assert.equal(new URL(uri).searchParams.get('limit'),'1');
    assert.equal(new URL(uri).searchParams.get('offset'),'0');
    assert.equal(new URL(uri).searchParams.has('filter'),false);
    const result=urls.length===1?answer(740,{id:taskId,name:'00737'}):
      answer(3700,{
        productionTask:{meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/productiontask/'+taskId}},
        productionRow:{meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/productiontask/'+taskId+'/productionRows/'+rowId}}
      });
    active--;
    return result;
  });
  const result=await handler({request:await req(),env});
  assert.equal(result.status,200);
  const data=await result.json();
  assert.deepEqual(urls.map(x=>new URL(x).pathname.split('/').at(-1)),['productiontask','productionstage']);
  assert.equal(peak,1);
  assert.equal(data.requests,2);
  assert.equal(data.totalTaskDocuments,740);
  assert.equal(data.totalProductionStages,3700);
  assert.equal(data.estimatedTaskListPages50,15);
  assert.equal(data.estimatedStageListPages50,74);
  assert.equal(data.sampleStageHasTaskReference,'observed');
  assert.equal(data.sampleStageHasRowReference,'observed');
  assert.equal(data.bulkStageJoinProven,false);
  assert.equal(data.allUnfinishedVerified,false);
  assert.equal(data.verifiedUnfinishedCount,null);
  assert.equal(data.changedRecords,0);
  assert.doesNotMatch(JSON.stringify(data),/00737|synthetic-access-token|009d69bb/);
});
test('authorization and query guard prevent upstream access',async()=>{
  let calls=0;
  const handler=createProductionCoverageProbeHandler(async()=>{calls++;throw Error('must not call');});
  for(const [s,url,e,status] of [
    [null,ENDPOINT,env,401],
    ['different',ENDPOINT,env,403],
    ['owner-id',ENDPOINT+'?limit=1000',env,400],
    ['owner-id',ENDPOINT,{...env,MS_API_TOKEN:''},503],
    ['owner-id',ENDPOINT,{...env,MS_API_TOKEN:'bad token'},503]
  ]){
    const result=await handler({request:await req(s,url),env:e});
    assert.equal(result.status,status);
  }
  assert.equal(calls,0);
});
test('stage request not attempted when task sampling fails',async()=>{
  let count=0;
  const handler=createProductionCoverageProbeHandler(async()=>{
    count++;return new Response('secret synthetic-access-token',{status:429});
  });
  const r=await handler({request:await req(),env});
  assert.equal(r.status,502);
  const body=await r.text();
  assert.match(body,/ms_rate_limited/);
  assert.equal((JSON.parse(body)).upstreamEntity,'productiontask');
  assert.equal((JSON.parse(body)).upstreamHttp,429);
  assert.doesNotMatch(body,/synthetic-access-token/);
  assert.equal(count,1);
});
test('stage failure cannot be misrepresented as zero unfinished production',async()=>{
  let count=0;
  const handler=createProductionCoverageProbeHandler(async()=>{
    count++;
    return count===1?answer(740,{id:taskId}):
      new Response('some upstream secret',{status:400});
  });
  const result=await handler({request:await req(),env});
  assert.equal(result.status,502);
  const body=await result.text();
  assert.match(body,/ms_upstream_error/);
  assert.equal((JSON.parse(body)).upstreamEntity,'productionstage');
  assert.equal((JSON.parse(body)).upstreamHttp,400);
  assert.doesNotMatch(body,/740|secret|synthetic-access-token/);
});
test('missing stage reference is explicitly unproven; empty stage collection remains unknown',()=>{
  const a=summarizeProductionCoverageProbe({count:5,sample:{}},{count:1,sample:{productionTask:{id:taskId}}});
  assert.equal(a.sampleStageHasTaskReference,'not_observed');
  assert.equal(a.allUnfinishedVerified,false);
  const b=summarizeProductionCoverageProbe({count:0,sample:null},{count:0,sample:null});
  assert.equal(b.sampleStageHasRowReference,'not_observed');
  assert.equal(b.verifiedUnfinishedCount,null);
  assert.throws(()=>summarizeProductionCoverageProbe({count:-1},{count:0}));
});
test('malformed upstream pagination cannot be taken as a successful scan',async()=>{
  const handler=createProductionCoverageProbeHandler(async()=>new Response(
    JSON.stringify({meta:{size:100},rows:[]}),{status:200}));
  const result=await handler({request:await req(),env});
  assert.equal(result.status,502);
  const body=await result.json();
  assert.equal(body.code,'ms_response_unverified');
  assert.equal(body.upstreamEntity,'productiontask');
  assert.equal(body.upstreamHttp,null);
});

test('missing stage list reveals safe 404 and collection only, never upstream body',async()=>{
  let calls=0;
  const handler=createProductionCoverageProbeHandler(async()=>{
    calls++;
    return calls===1?answer(900,{id:taskId}):
      new Response('secret-token arbitrary upstream diagnostics and private SKU',{status:404});
  });
  const result=await handler({request:await req(),env});
  assert.equal(result.status,502);
  const data=await result.json();
  assert.equal(calls,2);
  assert.equal(data.code,'ms_upstream_error');
  assert.equal(data.upstreamEntity,'productionstage');
  assert.equal(data.upstreamHttp,404);
  assert.equal(data.changedRecords,0);
  assert.equal(data.coverage,'NOT_VERIFIED');
  assert.doesNotMatch(JSON.stringify(data),/secret-token|arbitrary|900|private SKU|synthetic-access-token/);
});
test('owner-only errors never reveal collection/http or contact MoySklad',async()=>{
  let calls=0;
  const handler=createProductionCoverageProbeHandler(async()=>{calls++;throw Error('no network');});
  const result=await handler({request:await req(null),env});
  assert.equal(result.status,401);
  const data=await result.json();
  assert.equal(data.code,'owner_session_required');
  assert.equal(Object.hasOwn(data,'upstreamEntity'),false);
  assert.equal(Object.hasOwn(data,'upstreamHttp'),false);
  assert.equal(calls,0);
});
