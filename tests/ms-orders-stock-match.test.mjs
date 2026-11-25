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
test('authenticated bounded crosswalk reads catalogue and stock without writes',async()=>{
 const token='test-only-owner';
 const cookie=(await createSession('owner',token)).split(';')[0];
 const calls=[];
 const handler=createOrderStockMatch({fetcher:async(url,options)=>{
  calls.push({url,method:options.method,auth:options.headers.Authorization});
  const isCatalog=url.includes('/entity/assortment?');
  return Response.json({meta:{size:isCatalog?assorted.length:stocks.length},
   rows:isCatalog?assorted:stocks});
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
 assert.equal(data.completeCatalog,true);
 assert.equal(data.completeStockReport,true);
 assert.equal(data.matches[0].status,'matched_stock_report');
 assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x.method==='GET'&&x.auth==='Bearer test-moysklad-token'));
});
test('incomplete source snapshot is never returned as available',async()=>{
 const token='test-only-owner';
 const cookie=(await createSession('owner',token)).split(';')[0];
 const handler=createOrderStockMatch({fetcher:async()=>{
  return Response.json({meta:{size:3000},rows:[]});
 }});
 const res=await handler({request:new Request(endpoint,{method:'POST',headers:{
  Origin:ORIGIN,Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({skus:['vesta-1']})}),env:{
  OFFICE_SESSION_SECRET:token,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  MS_API_TOKEN:'test-moysklad-token'
 }});
 assert.equal(res.status,502);
 const data=await res.json();
 assert.equal(data.completeStockReport,false);
 assert.equal(data.completeCatalog,false);
});
