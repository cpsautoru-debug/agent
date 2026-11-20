import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {parseSnapshotScope,summarizeWarehouseSnapshot,createWarehouseSnapshotHandler}=
  await import('../../functions/api/ms/warehouse-snapshot.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const END='https://autosklad63-office-staging.pages.dev/api/ms/warehouse-snapshot';
const STORE_NAME='Пламя. Магазин';
const ID='f0000000-0000-4000-8000-000000000001';
const uuid=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const env={
  OFFICE_SESSION_SECRET:'synthetic-session-secret',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  MS_API_TOKEN:'synthetic-access-token',
  OZON_FINANCE_DB:{prepare(sql){
    assert.match(sql,/office_authorized_users/);
    return {bind(sub,email){
      assert.equal(email,'owner@example.invalid');
      return {async first(){return sub==='owner-id'?{allowed:1}:null;}};
    }};
  }}
};
async function req(sub='owner-id',url=END+'?store='+encodeURIComponent(STORE_NAME)){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(url,{headers});
}
const ok=data=>new Response(JSON.stringify(data),{status:200});
const stocks=n=>Array.from({length:n},(_,i)=>({
  assortmentId:uuid(i),storeId:ID,stock:i+1
}));
const stores={meta:{size:2},rows:[
  {id:ID,name:STORE_NAME},
  {id:'f0000000-0000-4000-8000-000000000002',name:'Склад материалов — внешний'}
]};
function mockFor(n,log){
  const entries=stocks(n);
  return async(uri,options)=>{
    const url=new URL(uri);
    log.push({url,options});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer synthetic-access-token');
    assert.equal(url.origin,'https://api.moysklad.ru');
    if(url.pathname.endsWith('/entity/store'))return ok(stores);
    if(url.pathname.endsWith('/report/stock/bystore/current')){
      assert.equal(url.searchParams.get('filter'),'storeId='+ID);
      return ok(entries);
    }
    assert.equal(url.pathname,'/api/remap/1.2/entity/assortment');
    assert.equal(url.searchParams.get('limit'),'10');
    assert.equal(url.searchParams.get('expand'),'uom');
    const ids=url.searchParams.get('filter').split(';').map(s=>s.slice(3));
    assert.ok(ids.length>0&&ids.length<=10);
    return ok({meta:{size:ids.length},rows:ids.map((id,i)=>({
      id,name:'Товар '+id.slice(-3),code:'SKU'+id.slice(-3),
      pathName:i%2===0?'Коврики Ева Пресс форма/Иномарки/Kia':null,
      uom:{name:'шт'}
    }))});
  };
}
test('31 SKU store is returned completely in one request, max six sequential upstream GETs',async()=>{
  const log=[],delays=[];
  const handler=createWarehouseSnapshotHandler(mockFor(31,log),async ms=>{delays.push(ms);});
  const response=await handler({request:await req(),env});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.code,'ms_warehouse_snapshot_ok');
  assert.equal(body.scope,'ONE_STORE_NONZERO_SNAPSHOT_MAX_40');
  assert.equal(body.completeForCurrentReport,true);
  assert.equal(body.warehouseName,STORE_NAME);
  assert.equal(body.warehouseLines,31);
  assert.equal(body.itemCount,31);
  assert.equal(body.namesResolved,31);
  assert.equal(body.positiveRows,31);
  assert.equal(body.unknownRows,0);
  assert.equal(body.requests,6);
  assert.equal(body.items[0].uom,'шт');
  assert.equal(body.items[0].stock,1);
  assert.equal(body.items[30].stock,31);
  assert.equal(log.length,6);
  assert.deepEqual(delays,[2000,2000,2000,2000,2000]);
  assert.deepEqual(log.slice(2).map(x=>x.url.searchParams.get('filter').split(';').length),
    [10,10,10,1]);
  assert.doesNotMatch(JSON.stringify(body),/00000000-0000-4000-8000-|synthetic-access-token/);
  assert.equal(body.changedRecords,0);
});
test('17 material SKU store finishes in four upstream GETs with two name batches',async()=>{
  const calls=[],delays=[];
  const h=createWarehouseSnapshotHandler(mockFor(17,calls),async n=>delays.push(n));
  const r=await h({request:await req(),env});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.items.length,17);
  assert.equal(data.requests,4);
  assert.equal(calls.length,4);
  assert.deepEqual(delays,[2000,2000,2000]);
});
test('over 40 SKU returns explicit limit and never makes name lookup',async()=>{
  const calls=[];
  const h=createWarehouseSnapshotHandler(mockFor(41,calls),async()=>{});
  const r=await h({request:await req(),env});
  assert.equal(r.status,409);
  assert.deepEqual(await r.json(),{
    code:'warehouse_snapshot_over_limit',limit:40,readOnly:true,changedRecords:0
  });
  assert.equal(calls.length,2);
});
test('stock of a different store and duplicate assortment IDs fail closed',async()=>{
  for(const items of [
    [{assortmentId:uuid(0),storeId:'f0000000-0000-4000-8000-000000000002',stock:1}],
    [stocks(1)[0],stocks(1)[0]]
  ]){
    let calls=0;
    const h=createWarehouseSnapshotHandler(async()=>{
      calls++;
      return calls===1?ok(stores):ok(items);
    },async()=>{});
    const r=await h({request:await req(),env});
    assert.equal(r.status,502);
    assert.equal((await r.json()).code,'ms_snapshot_unverified');
    assert.equal(calls,2);
  }
});
test('missing or mismatched assortment names invalidate whole snapshot',async()=>{
  const h=createWarehouseSnapshotHandler(async uri=>{
    const path=new URL(uri).pathname;
    if(path.endsWith('store'))return ok(stores);
    if(path.endsWith('current'))return ok(stocks(1));
    return ok({meta:{size:0},rows:[]});
  },async()=>{});
  const r=await h({request:await req(),env});
  assert.equal(r.status,502);
  const result=await r.json();
  assert.equal(result.code,'ms_snapshot_unverified');
  assert.equal(Object.hasOwn(result,'items'),false);
});
test('403 and 429 at every stage abort immediately, never disclose upstream body',async()=>{
  for(const failOn of [1,2,3,4]){
    let calls=0;
    const h=createWarehouseSnapshotHandler(async(uri,opts)=>{
      calls++;
      if(calls===failOn)return new Response('sensitive warehouse SKU token',{status:429});
      return mockFor(17,[])(uri,opts);
    },async()=>{});
    const response=await h({request:await req(),env});
    assert.equal(response.status,502);
    const out=await response.text();
    assert.equal(JSON.parse(out).code,'ms_rate_limited');
    assert.equal(JSON.parse(out).upstreamHttp,429);
    assert.equal(calls,failOn);
    assert.doesNotMatch(out,/sensitive|token|SKU/);
  }
});
test('owner auth, invalid scope and methods block upstream completely',async()=>{
  let calls=0;
  const h=createWarehouseSnapshotHandler(async()=>{calls++;throw Error('should not call');},
    async()=>{});
  for(const [sub,url,settings,status] of [
    [null,END+'?store='+encodeURIComponent(STORE_NAME),env,401],
    ['outsider',END+'?store='+encodeURIComponent(STORE_NAME),env,403],
    ['owner-id',END+'?store='+encodeURIComponent(STORE_NAME)+'&page=1',env,400],
    ['owner-id',END+'?store='+encodeURIComponent(STORE_NAME)+'&store=duplicate',env,400],
    ['owner-id',END+'?store='+encodeURIComponent('test\nbad'),env,400],
    ['owner-id',END+'?store='+encodeURIComponent(STORE_NAME),{...env,MS_API_TOKEN:''},503],
    ['owner-id','https://evil.example/api/ms/warehouse-snapshot?store='+encodeURIComponent(STORE_NAME),env,400]
  ]){
    const r=await h({request:await req(sub,url),env:settings});
    assert.equal(r.status,status);
  }
  assert.equal((await h({request:new Request(END,{method:'POST'}),env})).status,405);
  assert.equal(calls,0);
});
test('empty store has 0 nonzero lines with no classification and 2 upstream GETs',async()=>{
  const calls=[];
  const h=createWarehouseSnapshotHandler(mockFor(0,calls),async()=>{});
  const r=await h({request:await req(),env});
  assert.equal(r.status,200);
  const out=await r.json();
  assert.deepEqual(out.items,[]);
  assert.equal(out.requests,2);
  assert.equal(out.warehouseLines,0);
  assert.equal(out.completeForCurrentReport,true);
});
test('malformed summary counts and missing names cannot be reported complete',()=>{
  const lines=[{id:uuid(0),stock:2},{id:uuid(1),stock:3}];
  assert.throws(()=>summarizeWarehouseSnapshot(lines,new Map(),{name:STORE_NAME},3));
  assert.throws(()=>summarizeWarehouseSnapshot(stocks(41),new Map(),{name:STORE_NAME},6));
  const names=new Map(lines.map((x,i)=>[x.id,{name:'Test '+i,uom:'шт'}]));
  const good=summarizeWarehouseSnapshot(lines,names,{name:STORE_NAME},3);
  assert.equal(good.itemCount,2);
  assert.equal(good.items[0].stock,2);
  assert.equal(good.items[0].uom,'шт');
});
