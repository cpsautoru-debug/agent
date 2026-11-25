import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {matchOrdersStock,createOrderStockMatch}
 from '../functions/api/ms/orders-stock-match.js';

const A='a1234567-bbbb-cccc-dddd-123456789abc';
const B='b1234567-bbbb-cccc-dddd-123456789abc';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const endpoint=ORIGIN+'/api/ms/orders-stock-match';
const assorted=[{id:A,article:'vesta-1',code:'ms-001',name:'Чехлы Vesta'},
 {id:B,article:'other',code:'X',name:'Другой'}];
const stocks=[{meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+A},
 stockByStore:[{name:'Основной склад (Цех)',stock:3,reserve:1},
 {name:'Склад Пламя',stock:1,reserve:1}]}];

test('exact SKU crosswalk keeps stock and reserve per store, not physical proof',()=>{
 const found=matchOrdersStock(['vesta-1','missing'],assorted,stocks);
 assert.equal(found[0].status,'matched_stock_report');
 assert.equal(found[0].accountingTotal,4);
 assert.equal(found[0].stores[0].accountingFree,2);
 assert.equal(found[0].stores[1].accountingFree,0);
 assert.equal(found[1].status,'not_matched');
 assert.equal(found[1].accountingTotal,null);
});
test('two distinct assortment entities with same SKU remain ambiguous',()=>{
 const result=matchOrdersStock(['vesta-1'],[...assorted,
  {id:B,article:'vesta-1',code:'other'}],stocks);
 assert.equal(result[0].status,'ambiguous');
 assert.equal(result[0].stores.length,0);
});
test('stock source missing and invalid warehouse data never imply availability',()=>{
 assert.equal(matchOrdersStock(['vesta-1'],assorted,[])[0].status,
  'matched_stock_unknown');
 assert.throws(()=>matchOrdersStock(['vesta-1'],assorted,[{
  meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+A},
  stockByStore:[{name:'Цех',stock:5}]
 }]),/stock_stores_unverified/);
});
test('unauthenticated and origin-mismatched requests cannot read MoySklad',async()=>{
 let calls=0;const handler=createOrderStockMatch({fetcher:()=>{calls++;throw Error('forbidden');}});
 const blocked=await handler({request:new Request(endpoint,{method:'POST',
  headers:{Origin:ORIGIN,'Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})}),env:{}});
 assert.equal(blocked.status,503);
 assert.equal(calls,0);
 const crossSite=await handler({request:new Request(endpoint,{method:'POST',
  headers:{Origin:'https://evil.example','Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})}),env:{}});
 assert.equal(crossSite.status,403);assert.equal(calls,0);
});
test('authenticated owner can probe exact SKU without full-catalog download',async()=>{
 const token='test-only-owner';
 const cookie=(await createSession('owner',token)).split(';')[0];
 const calls=[];
 const handler=createOrderStockMatch({fetcher:async(url,options)=>{
  calls.push({url,method:options.method,auth:options.headers.Authorization});
  const u=new URL(url);
  if(u.pathname.endsWith('/entity/assortment')){
   assert.equal(u.searchParams.get('search'),'vesta-1');
   assert.equal(u.searchParams.has('filter'),false);
   return Response.json({meta:{size:1},rows:[{...assorted[0],meta:{href:
      'https://api.moysklad.ru/api/remap/1.2/entity/product/'+A}}]});
  }
  if(u.pathname.endsWith('/report/stock/bystore'))
   return Response.json({meta:{size:1},rows:stocks});
  throw Error('unrecognized request');
 }});
 const request=new Request(endpoint,{method:'POST',headers:{
  Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})});
 const env={OFFICE_SESSION_SECRET:token,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  MS_API_TOKEN:'test-moysklad-token'};
 const res=await handler({request,env});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.code,'ms_orders_stock_match');
 assert.equal(data.readOnly,true);
 assert.equal(data.changedRecords,0);
 assert.equal(data.targetedSkuChecks,true);
 assert.equal(data.matches[0].status,'matched_stock_report');
 assert.equal(data.matches[0].stores[0].accountingFree,2);
 assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x.method==='GET'&&x.auth==='Bearer test-moysklad-token'));
 assert.ok(calls.every(x=>!x.url.endsWith('entity/assortment')));
});
test('truncated context search does not prove no exact match',async()=>{
 const token='test-only-owner';
 const cookie=(await createSession('owner',token)).split(';')[0];
 let calls=0;
 const handler=createOrderStockMatch({fetcher:async()=>{
  calls++;
  return Response.json({meta:{size:30},rows:[{id:A,name:'irrelevant'}]});
 }});
 const res=await handler({request:new Request(endpoint,{method:'POST',headers:{
  Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})}),env:{
  OFFICE_SESSION_SECRET:token,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  MS_API_TOKEN:'test-moysklad-token'
 }});
 const obj=await res.json();
 assert.equal(obj.matches[0].status,'unverified');
 assert.equal(obj.matches[0].reason,'search_truncated');
 assert.equal(obj.matches[0].accountingTotal,null);
 assert.equal(calls,1);
});
test('verified SKU match remains known when stock filter is rejected',async()=>{
 const token='test-only-owner';
 const cookie=(await createSession('owner',token)).split(';')[0];
 const handler=createOrderStockMatch({fetcher:async url=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/entity/assortment'))return Response.json({
   meta:{size:1},rows:[{...assorted[0],meta:{href:
    'https://api.moysklad.ru/api/remap/1.2/entity/product/'+A}}]});
  return new Response('{}',{status:412});
 }});
 const res=await handler({request:new Request(endpoint,{method:'POST',headers:{
  Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})}),env:{
  OFFICE_SESSION_SECRET:token,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  MS_API_TOKEN:'test-moysklad-token'
 }});
 const obj=await res.json();
 assert.equal(obj.matches[0].status,'matched_stock_unknown');
 assert.equal(obj.matches[0].stockReason,'stock_filter_rejected');
 assert.equal(obj.matches[0].accountingTotal,null);
});
test('one oversized exact filter returns an unverified SKU, not a total failure',async()=>{
 const token='test-only-owner';
 const cookie=(await createSession('owner',token)).split(';')[0];
 const handler=createOrderStockMatch({fetcher:async()=>
  Response.json({meta:{size:1},rows:[{name:'X'.repeat(700000)}]})});
 const response=await handler({request:new Request(endpoint,{method:'POST',headers:{
  Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})}),env:{
  OFFICE_SESSION_SECRET:token,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  MS_API_TOKEN:'test-moysklad-token'
 }});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.matches[0].status,'unverified');
 assert.equal(data.matches[0].reason,'response_too_large');
 assert.equal(data.matches[0].accountingTotal,null);
});
