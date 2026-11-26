import test from 'node:test';
import assert from 'node:assert/strict';
import {createSalesBridge} from '../functions/api/ms/sales-bridge.js';
import {signBridgeRequest} from '../workers/ms-production-bridge-auth.js';
const secret='a'.repeat(43),other='b'.repeat(43),stamp=Date.now();
const url='https://autosklad63-office-staging.pages.dev/api/ms/sales-bridge?type=store&offset=0';
const env={MS_SALES_BRIDGE_SECRET:secret,MS_PRODUCTION_BRIDGE_SECRET:other,MS_API_TOKEN:'test-token'};
const path=new URL(url).pathname+new URL(url).search;
async function request(key,target=url,time=stamp){
 const u=new URL(target);
 return new Request(target,{headers:{'X-MS-Bridge-Time':String(time),'X-MS-Bridge-Signature':await signBridgeRequest(key,time,u.pathname+u.search)}});
}
test('sales bridge accepts only its own signed scoped request',async()=>{
 let calls=0;
 const handler=createSalesBridge({now:()=>stamp,fetcher:async(u,o)=>{calls++;assert.equal(o.method,'GET');assert.equal(new URL(u).pathname,'/api/remap/1.2/entity/store');return Response.json({rows:[],meta:{size:0}});}});
 assert.equal((await handler({request:await request(other),env})).status,401);
 assert.equal((await handler({request:new Request(url),env})).status,401);
 assert.equal((await handler({request:await request(secret,url,stamp-120000),env})).status,401);
 assert.equal((await handler({request:await request(secret,url+'&extra=1'),env})).status,400);
 assert.equal((await handler({request:new Request(url,{method:'POST'}),env})).status,405);
 assert.equal((await handler({request:await request(secret),env})).status,200);
 assert.equal(calls,1);
});
test('missing separate secret fails closed',async()=>{
 const handler=createSalesBridge({fetcher:()=>{throw Error('must not fetch');}});
 assert.equal((await handler({request:new Request(url),env:{MS_PRODUCTION_BRIDGE_SECRET:other}})).status,503);
});
