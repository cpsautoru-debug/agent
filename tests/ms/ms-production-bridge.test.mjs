import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {validBridgeSecret,signBridgeRequest,verifyBridgeRequest}=
  await import('../../workers/ms-production-bridge-auth.js');
const {parseBridgeScope,createProductionBridgeHandler}=
  await import('../../functions/api/ms/production-bridge.js');
const SECRET='A'.repeat(43);
const NOW=1_900_000_000_000;
const BASE='https://autosklad63-office-staging.pages.dev/api/ms/production-bridge';
const TASK_ID='00000000-0000-4000-8000-000000000001';
const taskUrl=BASE+'?kind=tasks&offset=0';
const stageUrl=BASE+'?kind=stages&taskId='+TASK_ID;
const response=(json,status=200)=>new Response(JSON.stringify(json),{status});
async function authorizedRequest(url,{secret=SECRET,stamp=String(NOW),signature}={}){
  const parsed=new URL(url);
  return new Request(url,{method:'GET',headers:{
    'X-MS-Bridge-Time':stamp,
    'X-MS-Bridge-Signature':signature??await signBridgeRequest(secret,stamp,parsed.pathname+parsed.search)
  }});
}
test('a fixed bridge accepts only 2 read-only production GET shapes',()=>{
  const task=parseBridgeScope(new URL(taskUrl));
  assert.match(task.url,/\/productiontask\?/);
  assert.equal(new URL(task.url).searchParams.get('limit'),'5');
  const stages=parseBridgeScope(new URL(stageUrl));
  assert.match(stages.url,/\/productionstage\?/);
  assert.equal(new URL(stages.url).searchParams.get('expand'),'stage');
  assert.ok(new URL(stages.url).searchParams.get('filter').endsWith('/'+TASK_ID));
  for(const url of [
    BASE+'?kind=tasks&offset=-1',
    BASE+'?kind=tasks&offset=1',
    BASE+'?kind=tasks&offset=5&offset=5',
    BASE+'?kind=tasks&offset=0&operation=delete',
    BASE+'?kind=stages&taskId=evil',
    BASE+'?kind=stages&taskId='+TASK_ID+'&taskId='+TASK_ID,
    BASE+'?kind=productionorder&offset=0',
    BASE+'?kind=tasks&offset=0#hash',
    'https://attacker.example/api/ms/production-bridge?kind=tasks&offset=0'
  ])assert.throws(()=>parseBridgeScope(new URL(url)),url);
});
test('HMAC rejects wrong signatures, stale timestamps and edited query',async()=>{
  assert.equal(validBridgeSecret(SECRET),true);
  assert.equal(validBridgeSecret('short'),false);
  const path=new URL(taskUrl).pathname+new URL(taskUrl).search;
  const sig=await signBridgeRequest(SECRET,String(NOW),path);
  assert.equal(await verifyBridgeRequest(SECRET,String(NOW),sig,path,NOW),true);
  assert.equal(await verifyBridgeRequest(SECRET,String(NOW),sig,path+'&offset=5',NOW),false);
  assert.equal(await verifyBridgeRequest(SECRET,String(NOW),sig,path,NOW+60001),false);
  assert.equal(await verifyBridgeRequest(SECRET,String(NOW),sig.replace(/^./,'f'===sig[0]?'a':'f'),path,NOW),false);
});
test('anonymous requests cannot access Pages secret or make upstream requests',async()=>{
  let calls=0;
  const handler=createProductionBridgeHandler({
    now:()=>NOW,fetcher:async()=>{calls++;throw Error('must not fetch');}
  });
  const env={MS_API_TOKEN:'synthetic-token',MS_PRODUCTION_BRIDGE_SECRET:SECRET};
  for(const request of [
    new Request(taskUrl),
    await authorizedRequest(taskUrl,{stamp:String(NOW-65000)}),
    await authorizedRequest(taskUrl,{signature:'0'.repeat(64)}),
    await authorizedRequest(taskUrl+'&offset=5',{signature:await signBridgeRequest(
      SECRET,String(NOW),new URL(taskUrl).pathname+new URL(taskUrl).search)})
  ]){
    const result=await handler({request,env});
    assert.equal(result.status,401);
    assert.doesNotMatch(await result.text(),/synthetic-token/);
  }
  assert.equal(calls,0);
});
test('only the existing Pages bearer reads a fixed MoySklad URL, never exposed',async()=>{
  const urls=[];
  const handler=createProductionBridgeHandler({now:()=>NOW,fetcher:async(url,opts)=>{
    urls.push(url);
    assert.equal(opts.headers.Authorization,'Bearer existing-encrypted-pages-token');
    assert.equal(opts.method,'GET');
    assert.equal(new URL(url).origin,'https://api.moysklad.ru');
    return response({meta:{size:0},rows:[]});
  }});
  const env={MS_API_TOKEN:'existing-encrypted-pages-token',MS_PRODUCTION_BRIDGE_SECRET:SECRET};
  const output=await handler({request:await authorizedRequest(taskUrl),env});
  assert.equal(output.status,200);
  assert.deepEqual(await output.json(),{meta:{size:0},rows:[]});
  assert.equal(urls.length,1);
  assert.equal(output.headers.get('Cache-Control'),'private, no-store');
  assert.equal(output.headers.get('Access-Control-Allow-Origin'),null);
  assert.doesNotMatch(JSON.stringify([...output.headers]),/existing-encrypted-pages-token/);
  const output2=await handler({request:await authorizedRequest(stageUrl),env});
  assert.equal(output2.status,200);
  assert.match(urls[1],/productionstage/);
});
test('rate limit, bad upstream body and missing secret fail closed',async()=>{
  const request=await authorizedRequest(taskUrl);
  for(const [fetcher,expected] of [
    [async()=>new Response('private rate limit diagnostic',{status:429}),429],
    [async()=>new Response('<html>not json</html>',{status:200}),502]
  ]){
    const handler=createProductionBridgeHandler({now:()=>NOW,fetcher});
    const r=await handler({request,env:{MS_PRODUCTION_BRIDGE_SECRET:SECRET,MS_API_TOKEN:'existing-token'}});
    assert.equal(r.status,expected);
    assert.doesNotMatch(await r.text(),/private rate limit|<html>|existing-token/);
  }
  const missing=createProductionBridgeHandler({now:()=>NOW,fetcher:async()=>{throw Error('must not fetch');}});
  assert.equal((await missing({request,env:{MS_API_TOKEN:'existing-token'}})).status,503);
});
