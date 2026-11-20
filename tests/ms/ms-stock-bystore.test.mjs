import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {parseStockScope,buildStockUrl,summarizeStockByStore,createStockHandler}=
  await import('../../functions/api/ms/stock-bystore.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ENDPOINT='https://autosklad63-office-staging.pages.dev/api/ms/stock-bystore';
const env={
  OFFICE_SESSION_SECRET:'synthetic-session-secret',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  MS_API_TOKEN:'synthetic-access-token',
  OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/office_authorized_users/);return{
    bind(sub,email){assert.equal(email,'owner@example.invalid');return{
      async first(){return sub==='owner-id'?{allowed:1}:null;}
    };}
  };}}
};
async function req(sub='owner-id',url=ENDPOINT){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(url,{headers});
}
const sample=[
  {name:'Экокожа чёрная 0,8',code:'728562135',uomName:'м',
    stockByStore:[
      {name:'Основной склад',stock:108,reserve:3,inTransit:0},
      {name:'Внешний склад',stock:40,reserve:null,inTransit:5}
    ]},
  {name:'Pegas',uomName:'м',
    stockByStore:[
      {name:'Основной склад',stock:-0.8},
      {name:'Внешний склад',stock:null}
    ]}
];
const reply=(size,rows)=>new Response(JSON.stringify({meta:{size},rows}),{
  status:200,headers:{'Content-Type':'application/json'}
});

test('bounded owner GET reads only one stock-by-store report page with no writes',async()=>{
  let count=0;
  const handler=createStockHandler(async(uri,options)=>{
    count++;
    const url=new URL(uri);
    assert.equal(url.origin,'https://api.moysklad.ru');
    assert.equal(url.pathname,'/api/remap/1.2/report/stock/bystore');
    assert.equal(url.searchParams.get('limit'),'10');
    assert.equal(url.searchParams.get('offset'),'0');
    assert.equal(url.searchParams.has('filter'),false);
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer synthetic-access-token');
    assert.equal(options.headers.Accept,'application/json;charset=utf-8');
    return reply(153,sample);
  });
  const r=await handler({request:await req(),env});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(count,1);
  assert.equal(data.code,'ms_stock_bystore_ok');
  assert.equal(data.totalAssortmentReportRows,153);
  assert.equal(data.hasMore,true);
  assert.equal(data.scope,'PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY');
  assert.deepEqual(data.warehousesInPage,['Основной склад','Внешний склад']);
  assert.equal(data.items[0].stores[0].stock,108);
  assert.equal(data.items[1].stores[0].stock,-0.8);
  assert.equal(data.items[1].stores[1].stock,null);
  assert.equal(data.items[0].stores[1].reserve,null);
  assert.equal(data.items[0].uom,'м');
  assert.equal(data.changedRecords,0);
  assert.doesNotMatch(JSON.stringify(data),/synthetic-access-token/);
});

test('report never turns unknown quantities or absent warehouses into zero',()=>{
  const out=summarizeStockByStore({meta:{size:1},rows:[{
    name:'Материал без информации о складе',stockByStore:[]
  }]},{offset:0,search:null});
  assert.deepEqual(out.warehousesInPage,[]);
  assert.deepEqual(out.items[0].stores,[]);
  assert.equal(out.totalAssortmentReportRows,1);
  assert.equal(out.changedRecords,0);
  assert.equal(out.hasMore,false);
  const p=summarizeStockByStore({meta:{size:1},rows:[{
    name:'Материал',stockByStore:[{name:'Основной склад',stock:0,reserve:0}]
  }]},{offset:0,search:null});
  assert.equal(p.items[0].stores[0].stock,0);
  assert.equal(p.items[0].stores[0].reserve,0);
  assert.equal(p.items[0].stores[0].inTransit,null);
});

test('search filter is constrained, encoded, and cannot become API URL or injection',()=>{
  const scope=parseStockScope(new URL(ENDPOINT+'?search='+encodeURIComponent('экокожа 0,8')+'&offset=10'));
  assert.deepEqual(scope,{offset:10,search:'экокожа 0,8'});
  const url=new URL(buildStockUrl(scope));
  assert.equal(url.searchParams.get('filter'),'search=экокожа 0,8');
  assert.equal(url.searchParams.get('offset'),'10');
  assert.equal(url.searchParams.get('limit'),'10');
  assert.equal(url.searchParams.has('expand'),false);
  assert.equal(url.origin,'https://api.moysklad.ru');
  for(const bad of [
    '?offset=-10','?offset=1','?offset=5000','?offset=0&offset=10',
    '?search=%3BproductFolder%3Dxxx','?search=%26foo%3Dbar',
    '?search=https%3A%2F%2Fevil.invalid','?search=а','?search=abc%20%20def',
    '?search=abc&search=def','?search=%20abc','?foo=bar',
    '?search=example%0Afoo','?utm_source=chatgpt'
  ])assert.throws(()=>parseStockScope(new URL(ENDPOINT+bad)),bad);
});

test('owner-only permissions, unrecognized query and HTTP method block upstream',async()=>{
  let calls=0;
  const handler=createStockHandler(async()=>{calls++;throw Error('should never reach network');});
  for(const [sub,endpoint,settings,status] of [
    [null,ENDPOINT,env,401],
    ['not-owner',ENDPOINT,env,403],
    ['owner-id',ENDPOINT+'?offset=99999',env,400],
    ['owner-id',ENDPOINT+'?filter=all',env,400],
    ['owner-id',ENDPOINT,{...env,MS_API_TOKEN:''},503],
    ['owner-id',ENDPOINT,{...env,MS_API_TOKEN:'bad token'},503],
    ['owner-id','https://evil.invalid/api/ms/stock-bystore',env,400]
  ]){
    const r=await handler({request:await req(sub,endpoint),env:settings});
    assert.equal(r.status,status);
    assert.equal(Object.hasOwn(await r.json(),'items'),false);
  }
  const post=await handler({request:new Request(ENDPOINT,{method:'POST'}),env});
  assert.equal(post.status,405);
  assert.equal(calls,0);
});

test('403 / 429 / 412 disclose only numeric status and fixed error code',async()=>{
  for(const [status,code] of [
    [403,'ms_stock_permission_denied'],[429,'ms_rate_limited'],
    [412,'ms_stock_upstream_error'],[401,'ms_token_rejected']
  ]){
    const handler=createStockHandler(async()=>new Response(
      'synthetic-access-token sensitive warehouse and SKU',{status}));
    const r=await handler({request:await req(),env});
    assert.equal(r.status,502);
    const body=await r.text();
    assert.equal(JSON.parse(body).code,code);
    assert.equal(JSON.parse(body).upstreamHttp,status);
    assert.equal(JSON.parse(body).changedRecords,0);
    assert.doesNotMatch(body,/synthetic-access-token|sensitive|SKU/);
  }
});

test('invalid and partial report is not interpreted as valid stock',()=>{
  const scope={offset:0,search:null};
  for(const payload of [
    {meta:{size:50},rows:[]},
    {meta:{size:-1},rows:sample},
    {meta:{},rows:sample},
    {meta:{size:1},rows:[{name:'a'}]},
    {meta:{size:1},rows:[{name:'a',stockByStore:[
      {name:'A',stock:5},{name:'A',stock:6}
    ]}]},
    {meta:{size:1},rows:[{name:'a',stockByStore:[
      {name:'A',stock:Infinity}
    ]}]},
    {meta:{size:1},rows:[{name:'a',stockByStore:[
      {name:'A',stock:'0'}
    ]}]},
    {meta:{size:1},rows:new Array(11).fill(sample[0])}
  ])assert.throws(()=>summarizeStockByStore(payload,scope));
});

test('pagination keeps total report rows separate from the ten-item page',()=>{
  const scope={offset:20,search:null};
  const p=summarizeStockByStore({meta:{size:31},rows:sample},scope);
  assert.equal(p.totalAssortmentReportRows,31);
  assert.equal(p.offset,20);
  assert.equal(p.pageSize,10);
  assert.equal(p.items.length,2);
  assert.equal(p.hasMore,true);
  const last=summarizeStockByStore({meta:{size:21},rows:sample},scope);
  assert.equal(last.hasMore,false);
  const empty=summarizeStockByStore({meta:{size:20},rows:[]},scope);
  assert.equal(empty.items.length,0);
  assert.equal(empty.hasMore,false);
});

test('malformed upstream response fails closed without token or fake figures',async()=>{
  const handler=createStockHandler(async()=>new Response('not json',{status:200}));
  const r=await handler({request:await req(),env});
  assert.equal(r.status,502);
  const body=await r.json();
  assert.equal(body.code,'ms_stock_unverified');
  assert.equal(Object.hasOwn(body,'totalAssortmentReportRows'),false);
  assert.equal(body.changedRecords,0);
});
