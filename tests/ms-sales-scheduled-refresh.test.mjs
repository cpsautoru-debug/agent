import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledRefresh} from '../functions/api/orders/scheduled-refresh.js';
import {refreshOrderSource,orderRotation} from '../workers/ms-sales-directory-sync.mjs';
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

test('all five sources rotate every 25 minutes and directories every 60',()=>{
 for(let start=0;start<12;start++){
 const slots=Array.from({length:5},(_,i)=>orderRotation(start+i));assert.equal(new Set(slots.map(x=>x.source)).size,5);
 const dirs=Array.from({length:12},(_,i)=>orderRotation(start+i).directory).filter(Boolean);assert.equal(dirs.length,4);assert.equal(new Set(dirs).size,4);
 }
});
test('worker exposes safe upstream failure reason',async()=>{
 await assert.rejects(refreshOrderSource({secret,source:'wb',now,fetcher:async()=>Response.json({reason:'order_feed_limit_reached'},{status:503})}),/order_sync_wb_503_order_feed_limit_reached/);
});

test('scheduled refresh preserves only allowlisted snapshot save failures',async()=>{for(const code of ['snapshot_incomplete_or_too_large','snapshot_unverified','persistent_queue_storage_unavailable','private upstream detail']){const handler=createScheduledRefresh({now,makeManual:()=>async()=>Response.json({complete:true}),save:async()=>Response.json({code},{status:503})});const r=await handler({request:await signed(),env});assert.equal(r.status,503);assert.equal((await r.json()).reason,code==='private upstream detail'?'snapshot_save_failed':code);}});

test('scheduled Yandex uses the same October scope as owner refresh',async()=>{const ypath='/api/orders/scheduled-refresh?source=yandex';const req=new Request('https://autosklad63-office-staging.pages.dev'+ypath,{method:'POST',headers:{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,ypath)}});const handler=createScheduledRefresh({now,makeYandex:opts=>{assert.equal(opts.fromDate,'2026-10-01');return async()=>Response.json({complete:true,coverage:'BOTH_CAMPAIGNS_SINCE_2026_10_01_COMPLETE',allOpenVerified:false});},save:async(d,source,data)=>{assert.equal(source,'yandex');assert.equal(data.allOpenVerified,false);return Response.json({code:'persistent_queue_source_saved',source});}});assert.equal((await handler({request:req,env})).status,200);});
