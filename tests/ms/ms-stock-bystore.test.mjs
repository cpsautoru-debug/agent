import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {
  parseStockScope,buildStockUrl,buildNamesUrl,
  extractStockIds,extractNames,summarizeStockByStore,createStockHandler
}=await import('../../functions/api/ms/stock-bystore.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ENDPOINT='https://autosklad63-office-staging.pages.dev/api/ms/stock-bystore';
const ONE='009d69bb-8c9f-11f1-0a80-00480002f1cd';
const TWO='009d69bb-8c9f-11f1-0a80-00480002f1ce';
const href=id=>'https://api.moysklad.ru/api/remap/1.2/entity/product/'+id+'?expand=supplier';
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
  {meta:{type:'product',href:href(ONE)},
    stockByStore:[
      {name:'Основной склад',stock:108,reserve:3,inTransit:0},
      {name:'Внешний склад',stock:40,reserve:null,inTransit:5}
    ]},
  {meta:{type:'product',href:href(TWO)},
    stockByStore:[
      {name:'Основной склад',stock:-0.8},
      {name:'Внешний склад',stock:null}
    ]}
];
const assort=[
  {id:ONE,name:'Экокожа чёрная 0,8',code:'728562135',uom:{name:'м'}},
  {id:TWO,name:'Pegas',uom:{name:'м'}}
];
const reply=(size,rows)=>new Response(JSON.stringify({meta:{size},rows}),{
  status:200,headers:{'Content-Type':'application/json'}
});

test('owner stock page loads one report and one name lookup, sequentially, no writes',async()=>{
  const urls=[];
  const handler=createStockHandler(async(uri,options)=>{
    const url=new URL(uri);urls.push(url);
    assert.equal(url.origin,'https://api.moysklad.ru');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer synthetic-access-token');
    if(url.pathname==='/api/remap/1.2/report/stock/bystore'){
      assert.equal(url.searchParams.get('limit'),'10');
      assert.equal(url.searchParams.get('offset'),'0');
      assert.equal(url.searchParams.get('groupBy'),'variant');
      assert.equal(url.searchParams.has('filter'),false);
      return reply(153,sample);
    }
    assert.equal(url.pathname,'/api/remap/1.2/entity/assortment');
    assert.equal(url.searchParams.get('filter'),'id='+ONE+';id='+TWO);
    assert.equal(url.searchParams.get('limit'),'10');
    return reply(2,assort);
  });
  const r=await handler({request:await req(),env});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.deepEqual(urls.map(x=>x.pathname),[
    '/api/remap/1.2/report/stock/bystore','/api/remap/1.2/entity/assortment'
  ]);
  assert.equal(data.code,'ms_stock_bystore_ok');
  assert.equal(data.requests,2);
  assert.equal(data.totalAssortmentReportRows,153);
  assert.equal(data.hasMore,true);
  assert.equal(data.namesResolved,2);
  assert.equal(data.scope,'PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY');
  assert.deepEqual(data.warehousesInPage,['Основной склад','Внешний склад']);
  assert.equal(data.items[0].name,'Экокожа чёрная 0,8');
  assert.equal(data.items[0].stores[0].stock,108);
  assert.equal(data.items[1].stores[0].stock,-0.8);
  assert.equal(data.items[1].stores[1].stock,null);
  assert.equal(data.items[0].stores[1].reserve,null);
  assert.equal(data.items[0].uom,'м');
  assert.equal(data.changedRecords,0);
  assert.doesNotMatch(JSON.stringify(data),/synthetic-access-token|009d69bb/);
});

test('missing warehouse or quantity is unknown, never default to zero',()=>{
  const one={meta:{href:href(ONE)},stockByStore:[]};
  const output=summarizeStockByStore({meta:{size:1},rows:[one]},{offset:0,search:null});
  assert.deepEqual(output.items[0].stores,[]);
  assert.equal(output.items[0].name,null);
  assert.equal(output.namesResolved,0);
  assert.equal(output.totalAssortmentReportRows,1);
  assert.equal(output.requests,2);
  const two={meta:{href:href(ONE)},stockByStore:[
    {name:'Основной склад',stock:0,reserve:0}
  ]};
  const p=summarizeStockByStore({meta:{size:1},rows:[two]},
    {offset:0,search:null},new Map([[ONE,{name:'Нулевой склад'}]]));
  assert.equal(p.items[0].stores[0].stock,0);
  assert.equal(p.items[0].stores[0].reserve,0);
  assert.equal(p.items[0].stores[0].inTransit,null);
});

test('empty report skips name lookup, never claims zero across all warehouses',async()=>{
  let count=0;
  const handler=createStockHandler(async()=>{
    count++;return reply(0,[]);
  });
  const r=await handler({request:await req(),env});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(count,1);
  assert.equal(data.totalAssortmentReportRows,0);
  assert.equal(data.requests,1);
  assert.deepEqual(data.warehousesInPage,[]);
});

test('search is encoded, bounded, rejects raw filter/URL injection',()=>{
  const scope=parseStockScope(new URL(ENDPOINT+'?search='+encodeURIComponent('экокожа 0,8')+'&offset=10'));
  assert.deepEqual(scope,{offset:10,search:'экокожа 0,8'});
  const url=new URL(buildStockUrl(scope));
  assert.equal(url.searchParams.get('filter'),'search=экокожа 0,8');
  assert.equal(url.searchParams.get('offset'),'10');
  assert.equal(url.searchParams.get('limit'),'10');
  assert.equal(url.searchParams.get('groupBy'),'variant');
  for(const bad of [
    '?offset=-10','?offset=1','?offset=5000','?offset=0&offset=10',
    '?search=%3BproductFolder%3Dxxx','?search=%26foo%3Dbar',
    '?search=https%3A%2F%2Fevil.invalid','?search=а','?search=abc%20%20def',
    '?search=abc&search=def','?search=%20abc','?foo=bar',
    '?search=example%0Afoo','?utm_source=chatgpt'
  ])assert.throws(()=>parseStockScope(new URL(ENDPOINT+bad)),bad);
});

test('assortment filter can request at most ten canonical IDs',()=>{
  const url=new URL(buildNamesUrl([ONE,TWO]));
  assert.equal(url.searchParams.get('filter'),'id='+ONE+';id='+TWO);
  assert.equal(url.searchParams.get('limit'),'10');
  assert.equal(url.origin,'https://api.moysklad.ru');
  for(const ids of [[],[ONE,ONE],['../evil'],new Array(11).fill(ONE)])
    assert.throws(()=>buildNamesUrl(ids));
});

test('valid names are joined by UUID, never by page ordering',()=>{
  const names=extractNames({meta:{size:2},rows:[assort[1],assort[0]]},[ONE,TWO]);
  const data=summarizeStockByStore({meta:{size:2},rows:sample},
    {offset:0,search:null},names);
  assert.equal(data.items[0].name,'Экокожа чёрная 0,8');
  assert.equal(data.items[1].name,'Pegas');
  assert.equal(data.items[0].stores[1].stock,40);
  assert.doesNotMatch(JSON.stringify(data),/009d69bb/);
});

test('owner session, query/method and missing token guard block upstream',async()=>{
  let calls=0;
  const handler=createStockHandler(async()=>{calls++;throw Error('network unavailable');});
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

test('403/429/412 from report or name lookup never expose body',async()=>{
  for(const [status,code] of [
    [403,'ms_stock_permission_denied'],[429,'ms_rate_limited'],
    [412,'ms_stock_upstream_error'],[401,'ms_token_rejected']
  ]){
    for(const which of ['stockbystore','assortment']){
      let calls=0;
      const handler=createStockHandler(async()=>{
        calls++;
        if(which==='assortment'&&calls===1)return reply(153,sample);
        return new Response('synthetic-access-token sensitive SKU',{status});
      });
      const r=await handler({request:await req(),env});
      assert.equal(r.status,502);
      const body=await r.text();
      assert.equal(JSON.parse(body).code,code);
      assert.equal(JSON.parse(body).upstreamHttp,status);
      assert.equal(JSON.parse(body).upstream,which);
      assert.equal(JSON.parse(body).changedRecords,0);
      assert.equal(calls,which==='assortment'?2:1);
      assert.doesNotMatch(body,/synthetic-access-token|sensitive|SKU/);
    }
  }
});

test('invalid/partial/duplicate report or mismatched name lookup is not trusted',()=>{
  const scope={offset:0,search:null};
  for(const payload of [
    {meta:{size:50},rows:[]},
    {meta:{size:-1},rows:sample},
    {meta:{},rows:sample},
    {meta:{size:1},rows:[sample[0],sample[1]]},
    {meta:{size:2},rows:[sample[0],sample[0]]},
    {meta:{size:1},rows:[{meta:{href:'https://evil.invalid/x'},stockByStore:[]}]},
    {meta:{size:1},rows:[{meta:{href:href(ONE)}}]},
    {meta:{size:1},rows:[{meta:{href:href(ONE)},stockByStore:[
      {name:'A',stock:5},{name:'A',stock:6}
    ]}]},
    {meta:{size:1},rows:[{meta:{href:href(ONE)},stockByStore:[
      {name:'A',stock:Infinity}
    ]}]},
    {meta:{size:1},rows:[{meta:{href:href(ONE)},stockByStore:[
      {name:'A',stock:'0'}
    ]}]},
    {meta:{size:11},rows:new Array(11).fill(sample[0])}
  ])assert.throws(()=>summarizeStockByStore(payload,scope));
  assert.throws(()=>extractNames({meta:{size:1},rows:[
    {id:'a0000000-0000-4000-8000-000000000000',name:'Unrelated'}
  ]},[ONE,TWO]));
  assert.throws(()=>extractNames({meta:{size:2},rows:[assort[0],assort[0]]},[ONE,TWO]));
});

test('pagination remains scoped to the actual report, not an all-warehouse stock sum',()=>{
  const scope={offset:20,search:null};
  const p=summarizeStockByStore({meta:{size:31},rows:sample},scope);
  assert.equal(p.totalAssortmentReportRows,31);
  assert.equal(p.offset,20);
  assert.equal(p.pageSize,10);
  assert.equal(p.items.length,2);
  assert.equal(p.hasMore,true);
  const last=summarizeStockByStore({meta:{size:22},rows:sample},scope);
  assert.equal(last.hasMore,false);
  const empty=summarizeStockByStore({meta:{size:20},rows:[]},scope);
  assert.equal(empty.items.length,0);
  assert.equal(empty.hasMore,false);
});

test('invalid upstream JSON fails closed without fake stock',async()=>{
  const handler=createStockHandler(async()=>new Response('not json',{status:200}));
  const r=await handler({request:await req(),env});
  assert.equal(r.status,502);
  const data=await r.json();
  assert.equal(data.code,'ms_stock_unverified');
  assert.equal(Object.hasOwn(data,'totalAssortmentReportRows'),false);
  assert.equal(data.changedRecords,0);
});

test('catalog path is copied only from the real assortment grouping field',()=>{
  const details=extractNames({meta:{size:2},rows:[
    {id:ONE,name:'Pegas',pathName:'Материалы/Экокожа',uom:{name:'м'}},
    {id:TWO,name:'Vesta',pathName:'',uom:{name:'шт'}}
  ]},[ONE,TWO]);
  assert.equal(details.get(ONE).catalogPath,'Материалы/Экокожа');
  assert.equal(details.get(TWO).catalogPath,null);
  const snapshot=summarizeStockByStore({meta:{size:2},rows:sample},
    {offset:0,search:null},details);
  assert.equal(snapshot.items[0].catalogPath,'Материалы/Экокожа');
  assert.equal(snapshot.items[1].catalogPath,null);
  assert.equal(snapshot.items[0].uom,'м');
  assert.equal(snapshot.items[1].uom,'шт');
  assert.doesNotMatch(JSON.stringify(snapshot),/009d69bb/);
});
