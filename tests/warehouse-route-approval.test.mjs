import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {createWarehouseRouteApproval} from '../functions/api/orders/warehouse-route-approval.js';
const base='https://autosklad63-office-staging.pages.dev';
const path=base+'/api/orders/warehouse-route-approval';
const store='12345678-1234-4234-9234-1234567890ab';
const org='12345678-1234-4234-9234-1234567890ac';
const session=async()=>(await createSession('owner','approval-test')).split(';')[0];
const env=db=>({OFFICE_SESSION_SECRET:'approval-test',OFFICE_ALLOWED_EMAIL:'owner@example.test',
 OZON_FINANCE_DB:db,MS_API_TOKEN:'test-token'});
const fixture={source:'ozon',sellerAccount:'171189',storeId:store,organizationId:org,storeKind:'manufacturer'};
const req=async(method,body,auth=true)=>new Request(path,{method,headers:{
 ...(auth?{Cookie:await session()}:{}),Origin:base,'Content-Type':'application/json'},
 ...(body?{body:JSON.stringify(body)}:{})});
const db=({account=true,prior=null}={})=>{
 const writes=[];
 return {writes,prepare(sql){
  if(sql.includes('office_authorized_users'))return {bind:()=>({first:async()=>({allowed:1})})};
  if(sql.includes('SELECT 1 AS present'))return {bind:()=>({first:async()=>account?{present:1}:null})};
  if(sql.includes('SELECT store_id,organization_id,store_kind'))return {bind:()=>({first:async()=>prior})};
  if(sql.startsWith('INSERT INTO office_order_warehouse_routes'))
   return {bind:(...args)=>({run:async()=>{writes.push(args);return {success:true,meta:{changes:1}};}})};
  if(sql.includes('SELECT DISTINCT source,account'))return {all:async()=>({results:[{source:'ozon',account:'171189'}]})};
  if(sql.includes('SELECT source,seller_account,store_id'))return {all:async()=>({results:[]})};
  throw Error('unexpected DB query: '+sql);
 }};
};
const fetcher=async(url,init)=>{
 assert.equal(init.method,'GET');
 const u=new URL(url);
 if(u.pathname.endsWith('/store'))return Response.json({meta:{size:1},rows:[{id:store,name:'Production'}]});
 if(u.pathname.endsWith('/organization'))return Response.json({meta:{size:1},rows:[{id:org,name:'Factory LLC'}]});
 if(u.pathname.endsWith('/store/'+store))return Response.json({id:store,name:'Production'});
 if(u.pathname.endsWith('/organization/'+org))return Response.json({id:org,name:'Factory LLC'});
 throw Error('unexpected upstream read '+url);
};
test('owner reads verified UUID choices without changing D1 or MoySklad',async()=>{
 const database=db();
 const result=await createWarehouseRouteApproval({fetcher})({
  request:await req('GET'),env:env(database)});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.stores[0].id,store);
 assert.equal(data.organizations[0].id,org);
 assert.equal(data.accounts[0].account,'171189');
 assert.equal(database.writes.length,0);
});
test('explicit owner selection persists exact validated route in D1 only',async()=>{
 const database=db();
 const result=await createWarehouseRouteApproval({fetcher})({
  request:await req('POST',fixture),env:env(database)});
 const data=await result.json();
 assert.equal(result.status,201);
 assert.equal(data.changedMoySkladRecords,0);
 assert.equal(data.code,'warehouse_route_approved');
 assert.equal(database.writes.length,1);
 assert.equal(database.writes[0][0],'ozon');
 assert.equal(database.writes[0][2],store);
});
test('unknown cabinet and existing mapping are never overwritten',async()=>{
 for(const config of [{account:false}, {prior:{store_id:store,organization_id:org,store_kind:'retail'}}]){
  const database=db(config);
  const result=await createWarehouseRouteApproval({fetcher})({
   request:await req('POST',fixture),env:env(database)});
  assert.equal(result.status,409);
  assert.equal(database.writes.length,0);
 }
});
test('incomplete MoySklad listing and unauthenticated requests fail closed',async()=>{
 const database=db();
 const handler=createWarehouseRouteApproval({fetcher:async()=>Response.json({
  meta:{size:101},rows:[]})});
 const r=await handler({request:await req('GET'),env:env(database)});
 assert.equal(r.status,503);
 assert.equal(database.writes.length,0);
 const anon=await handler({request:await req('POST',fixture,false),env:env(database)});
 assert.equal(anon.status,401);
});
