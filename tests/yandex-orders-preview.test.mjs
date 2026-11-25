import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {normalizeYandexOrderPreview,createYandexOrdersPreview}
 from '../functions/api/yandex/orders-preview.js';
const BASE='https://autosklad63-office-staging.pages.dev/api/yandex/orders-preview';
const CAMPAIGNS=[149082506,149106500];
const fixture={status:'OK',orders:[{orderId:123,campaignId:CAMPAIGNS[0],
 status:'PROCESSING',programType:'FBS',fake:false,
 items:[{offerId:'VESTA-01',count:2}]}],paging:{}};
const campaignLoader=async()=>CAMPAIGNS.map(campaignId=>({
 campaignId,businessId:12345,businessName:'test ООО'
}));
test('normalizes orders without buyer private data or write permission',()=>{
 const x=normalizeYandexOrderPreview({...fixture,orders:[{...fixture.orders[0],
 buyer:{name:'SECRET BUYER'},delivery:{address:'SECRET ADDRESS'}}]},CAMPAIGNS);
 assert.equal(x.length,1);
 assert.equal(x[0].externalKey,'AS63:yandex:149082506:123');
 assert.deepEqual(x[0].items,[{sku:'VESTA-01',quantity:2,assortmentMatch:'unverified'}]);
 assert.equal(x[0].productionQueue,'candidate_needs_inventory');
 assert.equal(x[0].duplicateStatus,'unverified');
 assert.equal(x[0].readyToWrite,false);
 assert.ok(!JSON.stringify(x).includes('SECRET'));
});
test('canceled and FBY orders cannot become sewing assignments',()=>{
 const orders=[{...fixture.orders[0],status:'CANCELLED'},
 {...fixture.orders[0],orderId:124,campaignId:CAMPAIGNS[1],programType:'FBY'}];
 const x=normalizeYandexOrderPreview({...fixture,orders},CAMPAIGNS);
 assert.equal(x.every(a=>a.productionQueue==='not_for_sewing'),true);
});
test('DELIVERY is not a sewing candidate even for FBS',()=>{
 const rows=normalizeYandexOrderPreview({...fixture,orders:[
  {...fixture.orders[0],status:'DELIVERY'},
  {...fixture.orders[0],orderId:125,status:'PROCESSING'}
 ]},CAMPAIGNS);
 assert.equal(rows[0].productionQueue,'not_for_sewing');
 assert.equal(rows[1].productionQueue,'candidate_needs_inventory');
});
test('invalid business campaign scope, fake order and wrong SKU fail closed',()=>{
 for(const change of [
  {campaignId:5},{fake:true},{items:[]},{items:[{offerId:'X',count:0}]}
 ])assert.throws(()=>normalizeYandexOrderPreview(
  {...fixture,orders:[{...fixture.orders[0],...change}]},CAMPAIGNS));
});
test('owner-only two-shop requests hit documented endpoint with bounded first page',async()=>{
 const secret='unit-test-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const req=new Request(BASE,{headers:{Cookie:cookie}});
 const env={OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  YANDEX_MARKET_API_KEY:'read-only-test-api-key'};
 let calls=0;
 const handler=createYandexOrdersPreview({campaignLoader,fetcher:async(url,opts)=>{
  calls++;
  assert.equal(url,'https://api.partner.market.yandex.ru/v1/businesses/12345/orders?limit=10');
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers['Api-Key'],'read-only-test-api-key');
  assert.deepEqual(JSON.parse(opts.body),{campaignIds:CAMPAIGNS,fake:false});
  return Response.json(fixture);
 }});
 const blocked=await handler({request:new Request(BASE),env});
 assert.equal(blocked.status,401);assert.equal(calls,0);
 const result=await handler({request:req,env});
 assert.equal(result.status,200);assert.equal(calls,1);
 const data=await result.json();
 assert.equal(data.readOnly,true);assert.equal(data.changedRecords,0);
 assert.equal(data.received,1);assert.equal(data.complete,true);
 assert.equal(data.approvedForWrite,false);
 assert.equal(data.duplicateScan,'NOT_PERFORMED');
});
test('unexpected third shop or different business cannot be mixed into orders',async()=>{
 const secret='test-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const handler=createYandexOrdersPreview({
  campaignLoader:async()=>[
   {campaignId:CAMPAIGNS[0],businessId:1},
   {campaignId:CAMPAIGNS[1],businessId:2}
  ],
  fetcher:()=>{throw Error('must not fetch');}
 });
 const r=await handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
  env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
   OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
   YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
 assert.equal(r.status,503);
 assert.equal((await r.json()).code,'yandex_order_campaign_scope_unverified');
});
