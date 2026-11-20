import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createStageHandler,summarizeStages}=await import('../../functions/api/ms/production-stages.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const TASK='009d69bb-8c9f-11f1-0a80-00480002f1cd';
const ROW_1='a0000001-0000-4000-8000-000000000001';
const ROW_2='a0000002-0000-4000-8000-000000000002';
const ROOT='https://autosklad63-office-staging.pages.dev/api/ms/production-stages?taskId='+TASK;
const env={
  OFFICE_SESSION_SECRET:'test-session-secret',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  MS_API_TOKEN:'test-secret-token',
  OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_authorized_users/);return{
    bind(sub,email){assert.equal(email,'owner@example.invalid');return{
      async first(){return sub==='owner'?{allowed:1}:null;}
    };}}
  }}
};
async function req(sub='owner',url=ROOT){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(url,{headers});
}
function stage(row,id,order,name,plan,done){
  return {
    id:'abc', totalQuantity:plan,completedQuantity:done,orderingPosition:order,
    productionRow:{meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/productionrow/'+id}},
    stage:{name}
  };
}
const fixture=[
  stage(1,ROW_1,0,'Раскрой материала',1,1),
  stage(1,ROW_1,1,'Пошив',1,1),
  stage(1,ROW_1,2,'Готово к отгрузке',1,1),
  stage(2,ROW_2,0,'Раскрой материала',2,2),
  stage(2,ROW_2,1,'Пошив',2,1),
  stage(2,ROW_2,2,'Готово к отгрузке',2,0)
];
test('stage plan is summed once by production row, final done from final stage only',()=>{
  const r=summarizeStages({meta:{size:fixture.length},rows:fixture});
  assert.equal(r.plan,3);
  assert.equal(r.finishedFinalStage,1);
  assert.equal(r.taskRows,2);
  assert.equal(r.stages.length,3);
  assert.deepEqual(r.stages.map(x=>x.done),[3,2,1]);
  assert.deepEqual(r.stages.map(x=>x.plan),[3,3,3]);
  assert.equal(r.changedRecords,0);
});
test('owner: one read-only call, correct filter and no token in response',async()=>{
  let calls=0;
  const handler=createStageHandler(async(uri,options)=>{
    calls++;
    const url=new URL(uri);
    assert.equal(url.pathname,'/api/remap/1.2/entity/productionstage');
    assert.equal(url.searchParams.get('filter'),'productionTask='+TASK);
    assert.equal(url.searchParams.get('expand'),'stage');
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer test-secret-token');
    assert.equal(options.headers.Accept,'application/json;charset=utf-8');
    return new Response(JSON.stringify({meta:{size:fixture.length},rows:fixture}),{status:200});
  });
  const response=await handler({request:await req(),env});
  const output=await response.json();
  assert.equal(response.status,200);
  assert.equal(output.code,'ms_production_stages_ok');
  assert.equal(output.plan,3);
  assert.equal(output.finishedFinalStage,1);
  assert.equal(output.requests,1);
  assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(output),/test-secret-token/);
});
test('anonymous, non-owner and empty token never call upstream',async()=>{
  let count=0;
  const handler=createStageHandler(async()=>{count++;throw Error('should not be called');});
  for(const [who,settings,code] of [
    [null,env,401],['other',env,403],['owner',{...env,MS_API_TOKEN:''},503]
  ]){
    const response=await handler({request:await req(who),env:settings});
    assert.equal(response.status,code);
  }
  assert.equal(count,0);
});
test('task scope rejects invalid IDs and extra query strings',async()=>{
  let count=0;
  const handler=createStageHandler(async()=>{count++;throw Error('should not be called');});
  for(const url of [ROOT+'&utm_source=chatgpt',ROOT.replace(TASK,'not-uuid'),ROOT.replace('?taskId=','?foo=')]){
    const response=await handler({request:await req('owner',url),env});
    assert.equal(response.status,400);
  }
  assert.equal(count,0);
});
test('incomplete or inconsistent stage data fails closed',()=>{
  assert.throws(()=>summarizeStages({meta:{size:51},rows:fixture}));
  assert.throws(()=>summarizeStages({meta:{size:7},rows:fixture}));
  assert.throws(()=>summarizeStages({meta:{size:2},rows:[
    stage(1,ROW_1,0,'Раскрой',1,0),stage(1,ROW_1,1,'Пошив',2,0)
  ]}));
  assert.throws(()=>summarizeStages({meta:{size:1},rows:[
    stage(1,ROW_1,0,'Раскрой',1,2)
  ]}));
});
test('upstream errors reveal only status codes, not messages, headers or secrets',async()=>{
  const handler=createStageHandler(async()=>new Response('test-secret-token sensitive body',{status:400}));
  const response=await handler({request:await req(),env});
  assert.equal(response.status,502);
  const text=await response.text();
  assert.match(text,/ms_stages_upstream_error/);
  assert.doesNotMatch(text,/test-secret-token|sensitive body/);
});
