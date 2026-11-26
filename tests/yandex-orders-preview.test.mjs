import test from 'node:test';

async function historyResponse(fetcher){
 const secret='bounded-history-yandex';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const handler=createYandexOrdersPreview({campaignLoader,fromDate:'2026-10-01',
  now:()=>Date.parse('2026-11-26T12:00:00Z'),fetcher});
 return handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
  env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
   OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
   YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
}
test('a failure in the later window cannot publish the earlier window as complete',async()=>{
 let calls=0;
 const res=await historyResponse(async()=>{
  calls++;
  return calls===1?Response.json({...fixture,orders:[]}):new Response('{}',{status:429});
 });
 const data=await res.json();
 assert.equal(res.status,503);assert.equal(calls,2);
 assert.equal(data.complete,false);assert.equal(data.changedRecords,0);
 assert.equal(data.orders,undefined);
});
test('history page budget is shared across windows and never publishes partial orders',async()=>{
 let calls=0;
 const res=await historyResponse(async()=>{
  calls++;
  return Response.json({...fixture,orders:[],paging:calls===1?{}:{nextPageToken:'page-'+calls}});
 });
 const data=await res.json();
 assert.equal(res.status,503);assert.equal(calls,20);
 assert.equal(data.code,'yandex_orders_page_limit');
 assert.equal(data.complete,false);assert.equal(data.orders,undefined);
});
test('pagination tokens may repeat between independent date windows',async()=>{
 const calls=new Map();
 const res=await historyResponse(async(url,opts)=>{
  const date=JSON.parse(opts.body).dates.creationDateFrom;
  const count=(calls.get(date)||0)+1;calls.set(date,count);
  return Response.json({...fixture,orders:[],paging:count===1?{nextPageToken:'same-token'}:{}});
 });
 assert.equal(res.status,200);
 assert.equal((await res.json()).pages,4);
 assert.deepEqual([...calls.values()],[2,2]);
});


test('historical read covers October 1 through today in contiguous bounded windows',async()=>{
 const secret='history-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const windows=[];
 const handler=createYandexOrdersPreview({campaignLoader,
  now:()=>Date.parse('2026-11-26T12:00:00Z'),fromDate:'2026-10-01',
  fetcher:async(url,opts)=>{
   const u=new URL(url),dates=JSON.parse(opts.body).dates;
   windows.push(dates);
   assert.equal(u.searchParams.has('fromDate'),false);
   return Response.json({...fixture,orders:[],paging:{}});
  }});
 const res=await handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
  env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
   OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
   YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.deepEqual(windows,[
  {creationDateFrom:'2026-10-01',creationDateTo:'2026-10-31'},
  {creationDateFrom:'2026-10-31',creationDateTo:'2026-11-27'}
 ]);
 assert.equal(data.coverage,'BOTH_CAMPAIGNS_SINCE_2026_10_01_COMPLETE');
 assert.equal(data.allOpenVerified,false);
 assert.equal(data.pages,2);
 assert.equal(data.complete,true);
 assert.equal(data.scope.fromDate,'2026-10-01');
 assert.equal(data.scope.toDateExclusive,'2026-11-27');
});
test('current read includes today and freezes date scope across pagination',async()=>{
 const secret='today-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const dates=[];
 const handler=createYandexOrdersPreview({campaignLoader,
  now:()=>Date.parse('2026-11-26T23:59:59Z'),
  fetcher:async(url,opts)=>{
   dates.push(JSON.parse(opts.body).dates);
   return Response.json({...fixture,orders:[],paging:dates.length===1?{nextPageToken:'p2'}:{}});
  }});
 const res=await handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
  env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
   OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
   YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
 assert.equal(res.status,200);
 assert.deepEqual(dates,[
  {creationDateFrom:'2026-10-28',creationDateTo:'2026-11-27'},
  {creationDateFrom:'2026-10-28',creationDateTo:'2026-11-27'}
 ]);
});

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
test('owner-only two-shop requests hit documented endpoint with bounded complete page',async()=>{
 const secret='unit-test-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const req=new Request(BASE,{headers:{Cookie:cookie}});
 const env={OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  YANDEX_MARKET_API_KEY:'read-only-test-api-key'};
 let calls=0;
 const handler=createYandexOrdersPreview({campaignLoader,fetcher:async(url,opts)=>{
  calls++;
  const parsed=new URL(url);
  assert.equal(parsed.origin,'https://api.partner.market.yandex.ru');
  assert.equal(parsed.pathname,'/v1/businesses/12345/orders');
  assert.equal(parsed.searchParams.get('limit'),'50');
  assert.equal(parsed.searchParams.has('fromDate'),false);
  assert.equal(parsed.searchParams.has('toDate'),false);
  assert.equal(parsed.searchParams.has('pageToken'),false);
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers['Api-Key'],'read-only-test-api-key');
  const body=JSON.parse(opts.body);
  assert.deepEqual(body.campaignIds,CAMPAIGNS);
  assert.equal(body.fake,false);
  assert.ok(body.dates.creationDateFrom);
  assert.ok(body.dates.creationDateTo);
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
test('Yandex preview paginates both shops and requires complete pages',async()=>{
 const secret='page-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const requests=[];
 const second={...fixture,orders:[{...fixture.orders[0],orderId:124,campaignId:CAMPAIGNS[1]}],paging:{}};
 const handler=createYandexOrdersPreview({campaignLoader,fetcher:async(url,opts)=>{
   const u=new URL(url);requests.push(u);
   assert.equal(opts.method,'POST');
   assert.deepEqual(JSON.parse(opts.body).campaignIds,CAMPAIGNS);
   return Response.json(requests.length===1?
     {...fixture,paging:{nextPageToken:'next-2'}}:second);
 }});
 const res=await handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
   env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
     OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
     YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
 const data=await res.json();
 assert.equal(res.status,200);assert.equal(data.complete,true);
 assert.equal(data.pages,2);assert.equal(data.received,2);
 assert.equal(requests[1].searchParams.get('pageToken'),'next-2');
 assert.equal(data.coverage,'BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE');
});
test('Yandex repeated order ID across pages cannot claim completeness',async()=>{
 const secret='dupe-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 let calls=0;
 const handler=createYandexOrdersPreview({campaignLoader,fetcher:async()=>{
   calls++;return Response.json({...fixture,paging:calls===1?{nextPageToken:'next'}:{}});
 }});
 const res=await handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
   env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
     OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
     YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
 assert.equal(res.status,503);
 assert.equal((await res.json()).code,'yandex_orders_response_unverified');
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

test('Yandex complete first page may contain more than ten orders',async()=>{
 const secret='eleven-yandex-session';
 const cookie=(await createSession('owner-sub',secret)).split(';')[0];
 const orders=Array.from({length:11},(_,i)=>({...fixture.orders[0],
   orderId:300+i,campaignId:CAMPAIGNS[i%2]}));
 const handler=createYandexOrdersPreview({campaignLoader,fetcher:async()=>{
   return Response.json({...fixture,orders,paging:{}});
 }});
 const response=await handler({request:new Request(BASE,{headers:{Cookie:cookie}}),
   env:{OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'x',
     OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
     YANDEX_MARKET_API_KEY:'read-only-test-api-key'}});
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.complete,true);
 assert.equal(data.received,11);
 assert.equal(data.orders.length,11);
});

