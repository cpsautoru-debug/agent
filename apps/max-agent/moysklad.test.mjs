import test from 'node:test';
import assert from 'node:assert/strict';
import {createMoyskladClient,MOYSKLAD_BASE,MoyskladError} from './moysklad.mjs';
import {makeServer} from './server.mjs';
const TOKEN='synthetic-moysklad-token-not-a-real-credential';
const id='00000000-0000-0000-0000-000000000001';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
const initialTokens=new WeakMap();
function setup(t,options={}){
  if(!initialTokens.has(t)){const prior=process.env.MOYSKLAD_API_TOKEN;initialTokens.set(t,true);t.after(()=>{if(prior===undefined)delete process.env.MOYSKLAD_API_TOKEN;else process.env.MOYSKLAD_API_TOKEN=prior;});}
  process.env.MOYSKLAD_API_TOKEN=TOKEN;
  return createMoyskladClient({minIntervalMs:0,retries:0,...options});
}
test('only GET, fixed host, environment-only bearer and gzip; assortment excludes stock',async t=>{
  const calls=[],client=setup(t,{fetcher:async(url,options)=>{calls.push({url,options});return json({rows:[],meta:{size:0,offset:0}});}});
  await client.page('assortment');await client.page('stockByStore',{filter:'moment=2026-10-20 08:00:00'});
  for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Authorization,'Bearer '+TOKEN);assert.equal(call.options.headers['Accept-Encoding'],'gzip');assert.ok(call.url.startsWith(MOYSKLAD_BASE+'/'));assert.ok(!call.url.includes(TOKEN));}
  assert.equal(calls[0].options.headers['X-Lognex-Remap-Beta-Feature'],'assortmentWithoutStock');
  assert.match(calls[1].url,/report\/stock\/bystore/);
  assert.match(new URL(calls[1].url).searchParams.get('filter'),/stockMode=all/);
});
test('all purchase/sales and both production generations have bounded collection reads',async t=>{
  const paths=[],client=setup(t,{fetcher:async url=>{paths.push(new URL(url).pathname);return json({rows:[]});}});
  for(const resource of ['products','variants','bundles','units','stores','purchaseOrders','supplies','customerOrders','demands','losses','processingOrders','processings','processingPlans','productionTasks','productionStageCompletions'])await client.all(resource);
  for(const type of ['processing','productiontask','productionstagecompletion','processingplan','supply','demand'])assert.ok(paths.includes('/api/remap/1.2/entity/'+type));
});
test('document positions/materials/products are GET and reject unapproved parts',async t=>{
  const paths=[],client=setup(t,{fetcher:async url=>{paths.push(url);return json(url.includes('/materials?')||url.includes('/positions?')?{rows:[]}:{id});}});
  assert.equal((await client.document('processings',id)).id,id);
  await client.positions('processings',id,'materials');await client.positions('supplies',id);
  await assert.rejects(()=>client.positions('supplies',id,'delete'),/invalid-document-part/);
  await assert.rejects(()=>client.document('processings','../metadata'),/invalid-document-id/);
  assert.equal(paths.length,3);
});
test('pagination derives offsets and refuses foreign nextHref without following it',async t=>{
  const calls=[],client=setup(t,{fetcher:async url=>{calls.push(url);const offset=Number(new URL(url).searchParams.get('offset'));return json({meta:{offset,size:3,...(offset===0?{nextHref:MOYSKLAD_BASE+'/entity/product?limit=2&offset=2'}:{})},rows:offset===0?[{id:'a'},{id:'b'}]:[{id:'c'}]});}});
  assert.equal((await client.all('products',{limit:2})).rows.length,3);assert.equal(calls.length,2);
  const evil=setup(t,{fetcher:async()=>json({rows:[{id}],meta:{offset:0,nextHref:'https://example.invalid/steal?offset=1'}})});
  await assert.rejects(()=>evil.all('products'),/invalid-next-page/);
});
test('pagination stops on source drift, duplicates, inconsistent offsets and bounds',async t=>{
  for(const mode of ['drift','duplicate','offset']){
    let calls=0;const client=setup(t,{fetcher:async()=>{calls++;return json({rows:[{id:mode==='duplicate'?'same':String(calls)}],meta:{size:mode==='drift'&&calls===2?3:2,offset:mode==='offset'?99:calls-1}});}});
    await assert.rejects(()=>client.all('products',{limit:1}),new RegExp(mode==='drift'?'snapshot-changed':mode==='duplicate'?'pagination-duplicate':'pagination-inconsistent'));
  }
  const client=setup(t,{fetcher:async url=>json({rows:[{id:new URL(url).searchParams.get('offset')}],meta:{size:3,offset:Number(new URL(url).searchParams.get('offset'))}})});
  await assert.rejects(()=>client.all('products',{limit:1},{maxPages:1}),/page-limit-exceeded/);
  await assert.rejects(()=>client.all('products',{limit:1},{maxRows:1}),/row-limit-exceeded/);
});
test('requests serialize and honor rate headers and bounded 429 retries',async t=>{
  let clock=0,active=0,peak=0,calls=0;const waits=[];
  const client=setup(t,{minIntervalMs:500,retries:1,now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;},fetcher:async()=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;calls++;return calls===1?json({},429,{'X-Lognex-Retry-After':'1200'}):json({rows:[]});}});
  await Promise.all([client.page('stores'),client.page('products')]);assert.equal(peak,1);assert.equal(calls,3);assert.ok(waits.includes(1200));assert.ok(waits.includes(500));
  let attempts=0;const defer=setup(t,{retries:2,fetcher:async()=>{attempts++;return json({},429,{'Retry-After':'999999'});}});
  await assert.rejects(()=>defer.page('stores'),/retry-deferred/);assert.equal(attempts,1);
});
test('errors do not leak upstream body, token or raw network exception',async t=>{
  for(const status of [401,403,404,415,500]){
    const client=setup(t,{fetcher:async()=>json({secret:TOKEN,errorMessage:'private-commercial-data'},status)});
    const result=await client.connection();assert.equal(result.connected,false);assert.ok(!JSON.stringify(result).includes(TOKEN));assert.ok(!JSON.stringify(result).includes('commercial'));assert.equal(result.upstreamStatus,status);
  }
  const client=setup(t,{fetcher:async()=>{throw Error(TOKEN);}});assert.equal((await client.connection()).error,'network-error');
  const timeout=setup(t,{fetcher:async()=>{throw new DOMException('secret','TimeoutError');}});assert.equal((await timeout.connection()).error,'timeout');
});
test('missing token, invalid query, large JSON, invalid JSON and redirects fail closed',async t=>{
  let calls=0;const client=setup(t,{fetcher:async()=>{calls++;return json({rows:[]});}});
  await assert.rejects(()=>client.page('https://example.invalid'),/invalid-resource/);
  await assert.rejects(()=>client.page('toString'),/invalid-resource/);
  await assert.rejects(()=>client.page('stores',{limit:1001}),/invalid-pagination/);
  await assert.rejects(()=>client.page('stores',{access_token:'x'}),/invalid-query/);
  delete process.env.MOYSKLAD_API_TOKEN;assert.equal((await client.connection()).error,'not-configured');assert.equal(calls,0);
  setup(t);const big=createMoyskladClient({minIntervalMs:0,maxBytes:4,fetcher:async()=>json({rows:[]})});await assert.rejects(()=>big.page('stores'),/response-too-large/);
  const bad=createMoyskladClient({minIntervalMs:0,fetcher:async()=>new Response('not JSON')});await assert.rejects(()=>bad.page('stores'),/invalid-response/);
  const redirect=createMoyskladClient({minIntervalMs:0,fetcher:async()=>new Response('',{status:302,headers:{Location:'https://example.invalid'}})});await assert.rejects(()=>redirect.page('stores'),/upstream-error/);
});
test('private data routes require a separate reader key; startup and public health never call MoySklad',async t=>{
  const key='reader'.repeat(8);let calls=0;
  const client={connection:async()=>{calls++;return {connected:true,readOnly:true};},page:async()=>{calls++;return {rows:[{id:'synthetic-private-record'}]};}};
  const server=makeServer({MOYSKLAD_READ_API_KEY:key},async()=>({}),async()=>({}),{registered:false},client);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,options)=>fetch(base+path,options);
  assert.equal((await request('/health')).status,200);assert.equal(calls,0);
  for(const path of ['/api/moysklad/products','/api/moysklad/connection?token='+key]){const result=await request(path);assert.equal(result.status,401);assert.ok(!(await result.text()).includes('synthetic-private'));}
  const auth={Authorization:'Bearer '+key};
  assert.equal((await request('/api/moysklad/products',{method:'POST',headers:auth})).status,405);
  assert.equal((await request('/api/moysklad/products?limit=101',{headers:auth})).status,400);
  assert.equal((await request('/api/moysklad/products?limit=1&limit=2',{headers:auth})).status,400);assert.equal(calls,0);
  const response=await request('/api/moysklad/products',{headers:auth});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).rows.length,1);assert.equal(calls,1);
  assert.equal((await request('/api/moysklad/connection',{headers:auth})).status,200);
});
