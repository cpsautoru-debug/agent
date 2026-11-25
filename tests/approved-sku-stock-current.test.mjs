import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {createApprovedStockCurrent} from '../functions/api/ms/approved-sku-stock-current.js';
const host='https://autosklad63-office-staging.pages.dev';
const endpoint=host+'/api/ms/approved-sku-stock-current';
const item='7d3da55a-760f-11f1-0a80-066a00250941';
const store='0fc26383-9897-11f0-0a80-0f0b001524a4';
const cookie=async()=>(await createSession('owner','stock-test')).split(';')[0];
const request=async(auth=true)=>new Request(endpoint,{method:'POST',
 headers:{Origin:host,'Content-Type':'application/json',...(auth?{Cookie:await cookie()}:{})},
 body:JSON.stringify({source:'ozon',sellerAccount:'171189',sku:'веста-коричневая'})});
const db=()=>({prepare(sql){
 if(sql.includes('office_authorized_users'))return {bind:()=>({first:async()=>({allowed:1})})};
 if(sql.includes('office_order_sku_links'))return {bind:()=>({first:async()=>({
  ms_item_id:item,ms_item_type:'product',ms_item_name:'Веста БП (Коричневая)'})})};
 if(sql.includes('office_order_warehouse_routes'))return {bind:()=>({first:async()=>({
  store_id:store,organization_id:'0fc0b0a2-9897-11f0-0a80-0f0b001524a1',
  store_kind:'manufacturer'})})};
 throw Error('unexpected query '+sql);
}});
const env=()=>({OFFICE_SESSION_SECRET:'stock-test',
 OFFICE_ALLOWED_EMAIL:'owner@example.test',OZON_FINANCE_DB:db(),MS_API_TOKEN:'unit-token'});
test('approved exact warehouse and SKU reconcile stock, reserve and free stock',async()=>{
 let calls=0;
 const fetcher=async url=>{
  calls++;
  const u=new URL(url);
  if(u.pathname.endsWith('/'+item))return Response.json({id:item,name:'Веста БП'});
  if(u.pathname.endsWith('/'+store))return Response.json({id:store,name:'Основной'});
  if(/entity\/(customerorder|productiontask)$/.test(u.pathname))return Response.json({meta:{size:0},rows:[]});
  assert.equal(u.pathname,'/api/remap/1.2/report/stock/bystore/current');
  assert.equal(u.searchParams.get('filter'),'assortmentId='+item);
  const field=u.searchParams.get('stockType');
  assert.ok(['stock','reserve','freeStock'].includes(field));
  const value={stock:4,reserve:2,freeStock:2}[field];
  return Response.json([{assortmentId:item,storeId:store,[field]:value}]);
 };
 const r=await createApprovedStockCurrent({fetcher})({
  request:await request(),env:env()});
 const x=await r.json();
 assert.equal(r.status,200);
 assert.equal(x.code,'approved_stock_current');
 assert.equal(x.stock,4);assert.equal(x.reserve,2);assert.equal(x.accountingFree,2);
 assert.equal(x.allocationAllowed,false);assert.equal(x.sewingAllowed,false);
 assert.equal(calls,7);
});
test('inconsistent stock and reserve block accounting numbers',async()=>{
 const fetcher=async url=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/'+item))return Response.json({id:item,name:'Веста БП'});
  if(u.pathname.endsWith('/'+store))return Response.json({id:store,name:'Основной'});
  const field=u.searchParams.get('stockType');
  return Response.json([{assortmentId:item,storeId:store,[field]:{
   stock:4,reserve:2,freeStock:4}[field]}]);
 };
 const r=await createApprovedStockCurrent({fetcher})({
  request:await request(),env:env()});
 const x=await r.json();
 assert.equal(x.code,'stock_current_unverified');
 assert.equal(x.stock,null);assert.equal(x.reserve,null);
});
test('anonymous caller cannot access stock or API token',async()=>{
 let reads=0;
 const r=await createApprovedStockCurrent({fetcher:()=>{reads++;throw Error();}})({
  request:await request(false),env:env()});
 assert.equal(r.status,401);assert.equal(reads,0);
});
test('expanded exact filter verifies signed balances and reports the failed legacy probe',async()=>{
 const root='https://api.moysklad.ru/api/remap/1.2/entity/';
 const handler=createApprovedStockCurrent({fetcher:async raw=>{
  const url=new URL(raw);
  if(url.pathname.endsWith('/'+item))return Response.json({id:item,name:'Веста'});
  if(url.pathname.endsWith('/'+store))return Response.json({id:store,name:'Основной склад'});
  if(url.pathname.endsWith('/current'))return Response.json([]);
  const filter=url.searchParams.get('filter');
  if(filter.startsWith('assortment='))return new Response(null,{status:400});
  assert.equal(filter,'product='+root+'product/'+item+';store='+root+'store/'+store+';stockMode=all');
  return Response.json({meta:{size:1},rows:[{meta:{href:root+'product/'+item+'?expand=supplier'},stockByStore:[
   {meta:{href:root+'store/'+store},stock:-1,reserve:0}
  ]}]});
 }});
 const result=await (await handler({request:await request(),env:env()})).json();
 assert.equal(result.code,'approved_stock_current');
 assert.equal(result.report,'expanded_exact');
 assert.equal(result.stock,-1);
 assert.equal(result.reserve,0);
 assert.equal(result.storeName,'Основной склад');
 assert.equal(result.diagnostics.find(x=>x.request==='expanded_legacy').httpStatus,400);
});
