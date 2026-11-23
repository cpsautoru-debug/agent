import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../../functions/api/auth/session.js';
import {createOzonAdsExpenseHandler} from '../../functions/api/ozon/ads-expense.js';
import {describeOzonAdsEvidence} from '../../web/office/ozon-ads-evidence.mjs';
import {readFileSync} from 'node:fs';
const SECRET='test-office-session-secret-secret-secret';
const MONTH='2026-10';
const url='https://autosklad63-office-staging.pages.dev/api/ozon/ads-expense?month='+MONTH;
const envelope={
 code:'ozon_expense_source_preview',source:'OZON_PERFORMANCE_API',
 month:MONTH,readOnly:true,changedRecords:0,
 recordCount:10,fieldNames:['date','campaignId'],
 totalExpenseKopecks:null,monetaryTotalsVerified:false,
 reconciledToFinance:false
};
const env=(allowed=1)=>({
 OFFICE_SESSION_SECRET:SECRET,OFFICE_ALLOWED_EMAIL:'owner@example.com',
 ADS_READ_TOKEN:'X'.repeat(48),
 OZON_ADS_WORKER:{fetch:async()=>{throw new Error('unexpected binding call in injected tests')}},
 OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_authorized_users/);
 return {bind(sub,email){assert.equal(sub,'test-owner');
 assert.equal(email,'owner@example.com');return {first:async()=>({allowed})}}}}}
});
async function req(path=url){
 const cookie=(await createSession('test-owner',SECRET)).split(';')[0];
 return new Request(path,{headers:{cookie}});
}
const makeFetch=(data=envelope,status=200,spy=[])=>async (address,init)=>{
 spy.push({address,init});
 return new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json'}
 });
};
test('owner receives only allowlisted source evidence; not an advertising amount',async()=>{
 const calls=[];const handler=createOzonAdsExpenseHandler({
   fetcher:makeFetch(envelope,200,calls),
   now:()=>Date.UTC(2026,10,22)
 });
 const response=await handler({request:await req(),env:env()});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.recordCount,10);
 assert.equal(body.totalExpenseKopecks,null);
 assert.equal(body.monetaryTotalsVerified,false);
 assert.equal(body.reconciledToFinance,false);
 assert.equal(calls.length,1);
 const addr=new URL(calls[0].address);
 assert.equal(addr.origin,'https://autosklad63-ozon-ads-staging.cpsautoru.workers.dev');
 assert.equal(addr.pathname,'/api/internal/expense');
 assert.equal(addr.searchParams.get('month'),MONTH);
 assert.equal(calls[0].init.headers.authorization,'Bearer '+'X'.repeat(48));
 assert.equal(JSON.stringify(body).includes('XXXXX'),false);
});
test('unauthenticated and forbidden requests never reach Worker',async()=>{
 let n=0;const handler=createOzonAdsExpenseHandler({
   now:()=>Date.UTC(2026,10,22),
   fetcher:async()=>{n++;throw Error('should not reach')}
 });
 assert.equal((await handler({request:new Request(url),env:env()})).status,401);
 assert.equal((await handler({request:await req(),env:env(0)})).status,403);
 assert.equal(n,0);
});
test('missing secret and invalid periods fail closed',async()=>{
 const handler=createOzonAdsExpenseHandler({now:()=>Date.UTC(2026,10,22),
 fetcher:async()=>{throw Error('unexpected')}});
 const missing=env();delete missing.ADS_READ_TOKEN;
 const absent=await handler({request:await req(),env:missing});
 assert.equal(absent.status,503);
 assert.equal((await absent.json()).code,'ads_bridge_secret_missing');
 const tooShort=env();tooShort.ADS_READ_TOKEN='short';
 const invalid=await handler({request:await req(),env:tooShort});
 assert.equal(invalid.status,503);
 assert.equal((await invalid.json()).code,'ads_bridge_secret_too_short');
 assert.equal((await handler({request:await req(url.replace(MONTH,'2026-11')),env:env()})).status,400);
 assert.equal((await handler({request:await req(url+'&other=1'),env:env()})).status,400);
});
test('untrusted upstream financial totals cannot pass schema validation',async()=>{
 const handler=createOzonAdsExpenseHandler({
 now:()=>Date.UTC(2026,10,22),
 fetcher:makeFetch({...envelope,monetaryTotalsVerified:true,
 totalExpenseKopecks:100000})
 });
 assert.equal((await handler({request:await req(),env:env()})).status,503);
});
test('upstream errors never leak response or authentication secrets',async()=>{
 const handler=createOzonAdsExpenseHandler({
 now:()=>Date.UTC(2026,10,22),
 fetcher:makeFetch({error:'private data'},503)
 });
 const result=await handler({request:await req(),env:env()});
 assert.equal(result.status,503);
 assert.deepEqual(await result.json(),{code:'ozon_ads_worker_http_error'});
});
test('known upstream errors stay actionable, secret-free and owner-only',async()=>{
 const handler=createOzonAdsExpenseHandler({
  now:()=>Date.UTC(2026,10,22),
  fetcher:makeFetch({code:'ozon_performance_auth_rejected',details:'secret cannot escape'},503)
 });
 const response=await handler({request:await req(),env:env()});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{code:'ozon_performance_auth_rejected'});
});
test('unknown upstream codes do not escape backend',async()=>{
 const handler=createOzonAdsExpenseHandler({
  now:()=>Date.UTC(2026,10,22),
  fetcher:makeFetch({code:'unknown\u005fsecret',details:'private'},503)
 });
 const response=await handler({request:await req(),env:env()});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{code:'ozon_ads_worker_http_error'});
});
test('network failures are distinct from an Ozon API HTTP error',async()=>{
 const handler=createOzonAdsExpenseHandler({
  now:()=>Date.UTC(2026,10,22),
  fetcher:async()=>{throw new Error('private transport detail');}
 });
 const res=await handler({request:await req(),env:env()});
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{code:'ozon_ads_transport_failure'});
});
test('missing ads Worker route is identified without leaking upstream response',async()=>{
 const handler=createOzonAdsExpenseHandler({
  now:()=>Date.UTC(2026,10,22),
  fetcher:makeFetch({error:'private internal detail'},404)
 });
 const res=await handler({request:await req(),env:env()});
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{code:'ozon_ads_worker_route_not_found'});
});
test('binding is required and token is not leaked',async()=>{
 const local=env();delete local.OZON_ADS_WORKER;
 const handler=createOzonAdsExpenseHandler({now:()=>Date.UTC(2026,10,22)});
 const res=await handler({request:await req(),env:local});
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{code:'ads_service_binding_missing'});
});
test('default handler invokes service binding directly with Request',async()=>{
 const local=env();const calls=[];
 local.OZON_ADS_WORKER={async fetch(request){
   assert.ok(request instanceof Request);
   calls.push({url:request.url,authorization:request.headers.get('authorization')});
   return new Response(JSON.stringify(envelope),
     {status:200,headers:{'content-type':'application/json'}});
 }};
 const handler=createOzonAdsExpenseHandler({now:()=>Date.UTC(2026,10,22)});
 const res=await handler({request:await req(),env:local});
 assert.equal(res.status,200);
 assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).pathname,'/api/internal/expense');
 assert.equal(calls[0].authorization,'Bearer '+'X'.repeat(48));
});
test('binding exception categories are sanitized without raw messages',async()=>{
 const messages=[
  ['Entrypoint default is not exported','ozon_ads_binding_entrypoint_error'],
  ['fetch failed: socket unreachable','ozon_ads_binding_network_error'],
  ['request is invalid','ozon_ads_binding_type_error']
 ];
 for(const [message,code] of messages){
   const handler=createOzonAdsExpenseHandler({now:()=>Date.UTC(2026,10,22)});
   const current=env();
   current.OZON_ADS_WORKER={fetch:async()=>{
     throw new TypeError(message);
   }};
   const result=await handler({request:await req(),env:current});
   assert.equal(result.status,503);
   const body=await result.json();
   assert.equal(body.code,code);
   assert.equal(JSON.stringify(body).includes(message),false);
 }
});
test('UI renders source status without calling profit mutations',()=>{
 assert.match(describeOzonAdsEvidence({
 ...envelope,code:'ozon_ads_office_preview'},MONTH),/НЕ СВЕРЕНЫ/);
 assert.throws(()=>describeOzonAdsEvidence({
 ...envelope,code:'ozon_ads_office_preview',monetaryTotalsVerified:true},MONTH));
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/ozon-ads-evidence.mjs',import.meta.url),'utf8');
 assert.match(html,/id="profitOzonAdsApiRefresh"/);
 assert.match(html,/id="profitOzonAdsApiStatus"/);
 assert.match(js,/\/api\/ozon\/ads-expense/);
 assert.doesNotMatch(js,/method:'POST'|localStorage|innerHTML/);
});

// The Ads worker is deployed separately from Pages. The Pages binding
// specifies entrypoint:"default", which must target a WorkerEntrypoint class.
test('ads Worker exposes default class entrypoint compatible with Pages binding',()=>{
 const source=readFileSync(new URL('../../workers/ozon-ads-staging.js',import.meta.url),'utf8');
 assert.match(source,/import\\s*\\{\\s*WorkerEntrypoint\\s*\\}\\s*from\\s*['\"]cloudflare:workers['\"]/);
 assert.match(source,/export default class OzonAdsWorker extends WorkerEntrypoint/);
 assert.match(source,/const env=this\\.env;/);
 assert.match(source,/auth!==['\"]Bearer ['\"]\\+env\\.ADS_READ_TOKEN/);
 assert.doesNotMatch(source,/export default\\s*\\{/);
});
