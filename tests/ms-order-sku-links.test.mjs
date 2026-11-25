import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {validSkuLink,createSkuLinkHandler} from '../functions/api/ms/order-sku-links.js';
const base='https://autosklad63-office-staging.pages.dev/api/ms/order-sku-links';
const itemId='12345678-1234-4234-9234-1234567890ab';
const payload={source:'yandex',sellerAccount:'149082506',sku:'карты_приора_черные_соты',itemType:'product',itemId};
const cookie=async()=> (await createSession('owner','unit-secret')).split(';')[0];
const env=(db)=>({OFFICE_SESSION_SECRET:'unit-secret',OFFICE_ALLOWED_EMAIL:'owner@test.example',
 OZON_FINANCE_DB:db,MS_API_TOKEN:'test-ms-token'});
const authDb={
 prepare(sql){
  if(sql.includes('office_authorized_users'))
   return {bind:()=>({first:async()=>({allowed:1})})};
  throw Error('table_missing');
 }
};
test('SKU mapping accepts only explicit scoped valid identity',()=>{
 assert.equal(validSkuLink(payload),true);
 assert.equal(validSkuLink({...payload,source:'plamya'}),false);
 assert.equal(validSkuLink({...payload,extra:'unsafe'}),false);
 assert.equal(validSkuLink({...payload,itemId:'fake'}),false);
});
test('missing D1 mapping table fails closed without fake mappings',async()=>{
 const handler=createSkuLinkHandler();
 const response=await handler({request:new Request(base,{headers:{Cookie:await cookie()}}),
  env:env(authDb)});
 assert.equal(response.status,503);
 assert.equal((await response.json()).code,'sku_links_storage_unavailable');
});
test('unauthenticated post cannot create link',async()=>{
 let invoked=0;
 const handler=createSkuLinkHandler({fetcher:async()=>{invoked++;throw Error('called');}});
 const response=await handler({request:new Request(base,{method:'POST',
  headers:{Origin:base.split('/api/')[0],'Content-Type':'application/json'},
  body:JSON.stringify(payload)}),env:env(authDb)});
 assert.equal(response.status,401);assert.equal(invoked,0);
});
test('owner selected link verifies MoySklad and inserts only into D1',async()=>{
 const writes=[];
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))
   return {bind:()=>({first:async()=>({allowed:1})})};
  if(sql.startsWith('SELECT ms_item_id'))
   return {bind:()=>({first:async()=>null})};
  if(sql.startsWith('INSERT INTO office_order_sku_links'))
   return {bind:(...values)=>({run:async()=>{writes.push(values);return {success:true};}})};
  throw Error('unexpected SQL');
 }};
 let reads=0;
 const handler=createSkuLinkHandler({fetcher:async(url,options)=>{
  reads++;
  assert.ok(url.endsWith('/entity/product/'+itemId));
  assert.equal(options.method,'GET');
  return Response.json({id:itemId,name:'Карты дверей Priora — чёрные соты'});
 }});
 const response=await handler({request:new Request(base,{method:'POST',
  headers:{Cookie:await cookie(),Origin:'https://autosklad63-office-staging.pages.dev',
   'Content-Type':'application/json'},body:JSON.stringify(payload)}),env:env(db)});
 assert.equal(response.status,201);
 const data=await response.json();
 assert.equal(data.code,'sku_link_approved');
 assert.equal(data.writeScope,'OFFICE_D1_ONLY');
 assert.equal(reads,1);assert.equal(writes.length,1);
 assert.equal(writes[0][0],'yandex');
 assert.equal(writes[0][2],payload.sku);
});
test('existing mapping is never overwritten or silently replaced',async()=>{
 const db={prepare(sql){
  if(sql.includes('office_authorized_users'))
   return {bind:()=>({first:async()=>({allowed:1})})};
  if(sql.startsWith('SELECT ms_item_id'))
   return {bind:()=>({first:async()=>({ms_item_id:itemId,ms_item_type:'product'})})};
  throw Error('writes forbidden');
 }};
 const handler=createSkuLinkHandler({fetcher:async()=>{throw Error('unexpected GET');}});
 const res=await handler({request:new Request(base,{method:'POST',headers:{
  Cookie:await cookie(),Origin:'https://autosklad63-office-staging.pages.dev',
  'Content-Type':'application/json'},body:JSON.stringify(payload)}),env:env(db)});
 assert.equal(res.status,409);
 assert.equal((await res.json()).same,true);
});
