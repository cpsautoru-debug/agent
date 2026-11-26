import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledRefresh} from '../functions/api/orders/scheduled-refresh.js';
import {refreshOrderSource} from '../workers/ms-sales-directory-sync.mjs';
import {signBridgeRequest} from '../workers/ms-production-bridge-auth.js';
const secret='a'.repeat(43),stamp=Date.parse('2026-11-26T09:00:00Z'),now=()=>stamp;
const path='/api/orders/scheduled-refresh?source=manual',url='https://autosklad63-office-staging.pages.dev'+path;
const db={prepare:()=>({bind:()=>({first:async()=>null})})};
const env={MS_SALES_BRIDGE_SECRET:secret,MS_ORDER_AUTO_SYNC:'enabled',OZON_FINANCE_DB:db};
async function signed(){return new Request(url,{method:'POST',headers:{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,path)}});}
test('only signed enabled requests trigger the existing reader and persistence',async()=>{
 let reads=0,saves=0;
 const handler=createScheduledRefresh({now,makeManual:opts=>async({request})=>{
  assert.equal(await opts.authorizeServer(request),true);
  assert.equal(await opts.authorizeServer(new Request(request.url)),false);
  reads++;return Response.json({complete:true});
 },save:async(d,source,data)=>{assert.equal(d,db);assert.equal(source,'manual');assert.equal(data.complete,true);saves++;return Response.json({code:'persistent_queue_source_saved',source,changedMoySkladRecords:0});}});
 assert.equal((await handler({request:new Request(url,{method:'POST'}),env})).status,401);
 assert.equal((await handler({request:await signed(),env:{...env,MS_ORDER_AUTO_SYNC:'disabled'}})).status,503);
 assert.equal((await handler({request:await signed(),env})).status,200);
 assert.equal(reads,1);assert.equal(saves,1);
});
test('worker sends signed POST and accepts only confirmed source result',async()=>{
 const result=await refreshOrderSource({secret,source:'manual',now,fetcher:async(u,o)=>{
  assert.equal(u,url);assert.equal(o.method,'POST');assert.equal(o.headers['X-MS-Bridge-Signature'],await signBridgeRequest(secret,stamp,path));
  return Response.json({source:'manual',code:'persistent_queue_source_saved',changedMoySkladRecords:0});
 }});
 assert.equal(result.source,'manual');
 await assert.rejects(refreshOrderSource({secret,source:'manual',now,fetcher:async()=>Response.json({source:'wb',code:'persistent_queue_source_saved',changedMoySkladRecords:0})}));
});
