import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {
  createWarehouseAvailabilityHandler,parseWarehouseScope,
  buildCurrentWarehouseUrl,findStore,parseCurrentStock,summarizeWarehouseAvailability
}=await import('../../functions/api/ms/warehouse-availability.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ENDPOINT='https://autosklad63-office-staging.pages.dev/api/ms/warehouse-availability';
const STORE_ID='f0000000-0000-4000-8000-000000000001';
const OTHER_ID='f0000000-0000-4000-8000-000000000002';
const PROD='009d69bb-8c9f-11f1-0a80-00480002f1cd';
const PROD2='009d69bb-8c9f-11f1-0a80-00480002f1ce';
const NAME='Склад материалов — внешний';
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
const answer=value=>new Response(JSON.stringify(value),{status:200});
async function req(sub='owner-id',url=ENDPOINT+'?store='+encodeURIComponent(NAME)){
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,env.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(url,{headers});
}
const stores={meta:{size:2},rows:[{id:STORE_ID,name:NAME},{id:OTHER_ID,name:'Основной склад (Цех)'}]};
const stock=[{assortmentId:PROD,storeId:STORE_ID,stock:40.5},
  {assortmentId:PROD2,storeId:STORE_ID,stock:-1}];
const assort={meta:{size:2},rows:[{id:PROD,name:'Эко кожа чёрная',uom:{name:'м'}},
  {id:PROD2,name:'Коврик',uom:{name:'шт'}}]};

test('one owner-triggered request uses three sequential read-only GETs, server-side store UUID filter',async()=>{
  const calls=[];
  const handler=createWarehouseAvailabilityHandler(async(uri,options)=>{
    calls.push(new URL(uri));
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer synthetic-access-token');
    if(calls.length===1){
      assert.equal(calls[0].pathname,'/api/remap/1.2/entity/store');
      assert.equal(calls[0].searchParams.get('limit'),'50');
      return answer(stores);
    }
    if(calls.length===2){
      assert.equal(calls[1].pathname,'/api/remap/1.2/report/stock/bystore/current');
      assert.equal(calls[1].searchParams.get('stockType'),'stock');
      assert.equal(calls[1].searchParams.get('filter'),'storeId='+STORE_ID);
      return answer(stock);
    }
    assert.equal(calls[2].pathname,'/api/remap/1.2/entity/assortment');
    assert.equal(calls[2].searchParams.get('limit'),'10');
    assert.equal(calls[2].searchParams.get('filter'),'id='+PROD+';id='+PROD2);
    return answer(assort);
  });
  const response=await handler({request:await req(),env});
  assert.equal(response.status,200);
  assert.equal(calls.length,3);
  const body=await response.json();
  assert.equal(body.code,'ms_warehouse_availability_ok');
  assert.equal(body.warehouseName,NAME);
  assert.equal(body.warehouseLines,2);
  assert.equal(body.positiveRows,1);
  assert.equal(body.negativeRows,1);
  assert.equal(body.unknownRows,0);
  assert.equal(body.namesResolved,2);
  assert.equal(body.items[0].name,'Эко кожа чёрная');
  assert.equal(body.items[0].uom,'м');
  assert.equal(body.items[0].stock,40.5);
  assert.equal(body.items[1].stock,-1);
  assert.equal(body.requests,3);
  assert.equal(body.changedRecords,0);
  assert.doesNotMatch(JSON.stringify(body),/f0000000|009d69bb|synthetic-access-token/);
});

test('unknown store or duplicate store names fail closed before current report',async()=>{
  for(const [name,storeList] of [
    ['Несуществующий склад',stores],
    [NAME,{meta:{size:2},rows:[{name:NAME,id:STORE_ID},{name:NAME,id:OTHER_ID}]}],
    [NAME,{meta:{size:51},rows:[{name:NAME,id:STORE_ID}]}]
  ]){
    let calls=0;
    const handler=createWarehouseAvailabilityHandler(async()=>{calls++;return answer(storeList);});
    const r=await handler({request:await req('owner-id',ENDPOINT+'?store='+encodeURIComponent(name)),env});
    assert.equal(r.status,502);
    assert.equal(calls,1);
    assert.equal(Object.hasOwn(await r.json(),'items'),false);
  }
});

test('parse store selection allows known punctuation but rejects user-selected endpoints/other parameters',()=>{
  assert.deepEqual(parseWarehouseScope(new URL(ENDPOINT+'?store='+encodeURIComponent(NAME))),{store:NAME});
  assert.deepEqual(parseWarehouseScope(new URL(ENDPOINT+'?store='+encodeURIComponent('Пламя. Магазин'))),
    {store:'Пламя. Магазин'});
  const u=new URL(buildCurrentWarehouseUrl(STORE_ID));
  assert.equal(u.origin,'https://api.moysklad.ru');
  assert.equal(u.searchParams.get('filter'),'storeId='+STORE_ID);
  assert.equal(u.searchParams.get('stockType'),'stock');
  assert.throws(()=>buildCurrentWarehouseUrl('../anything'));
  for(const q of [
    '', '?store=не', '?store='+encodeURIComponent('Склад\nМатериалов'),
    '?store='+encodeURIComponent(NAME)+'&store='+encodeURIComponent(NAME),
    '?store='+encodeURIComponent(NAME)+'&filter=anything',
    '?store='+encodeURIComponent('https://evil.invalid'),
    '?store='+encodeURIComponent('Склад;filter=all')
  ])assert.throws(()=>parseWarehouseScope(new URL(ENDPOINT+q)),q);
});

test('current report with empty warehouse has no names request, zero nonzero lines but not full-inventory claim',async()=>{
  let count=0;
  const handler=createWarehouseAvailabilityHandler(async()=>{
    count++;
    return count===1?answer(stores):answer([]);
  });
  const r=await handler({request:await req(),env});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(count,2);
  assert.equal(body.warehouseLines,0);
  assert.equal(body.scope,'WAREHOUSE_NONZERO_POSITIONS_ONLY_NOT_FULL_INVENTORY');
  assert.equal(body.requests,2);
  assert.deepEqual(body.items,[]);
});

test('current report cannot mix warehouse IDs or repeat SKUs',()=>{
  assert.throws(()=>parseCurrentStock([{assortmentId:PROD,storeId:OTHER_ID,stock:42}],STORE_ID));
  assert.throws(()=>parseCurrentStock([...stock,stock[0]],STORE_ID));
  assert.throws(()=>parseCurrentStock([{assortmentId:PROD,storeId:STORE_ID,stock:'1'}],STORE_ID));
  assert.throws(()=>parseCurrentStock(new Array(501).fill(stock[0]),STORE_ID));
});

test('null physical quantity stays unknown, negative stock never disappears',()=>{
  const lines=parseCurrentStock([
    {assortmentId:PROD,storeId:STORE_ID,stock:null},
    {assortmentId:PROD2,storeId:STORE_ID,stock:-0.5}
  ],STORE_ID);
  const sum=summarizeWarehouseAvailability(lines,new Map(),{name:NAME});
  assert.equal(sum.unknownRows,1);
  assert.equal(sum.negativeRows,1);
  assert.equal(sum.items[0].stock,null);
  assert.equal(sum.items[1].stock,-0.5);
  assert.equal(sum.namesResolved,0);
});

test('only first 10 named items returned; report total is distinct',()=>{
  const lines=Array.from({length:45},(_,i)=>({
    id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0'),stock:i+1
  }));
  const names=new Map(lines.slice(0,10).map(x=>[x.id,{name:'Item'}]));
  const output=summarizeWarehouseAvailability(lines,names,{name:NAME});
  assert.equal(output.warehouseLines,45);
  assert.equal(output.items.length,10);
  assert.equal(output.additionalRows,35);
  assert.equal(output.positiveRows,45);
  assert.equal(output.displayedCount,10);
});

test('anonymous, non-owner, invalid scope and invalid method never reach API',async()=>{
  let calls=0;
  const h=createWarehouseAvailabilityHandler(async()=>{calls++;throw Error('no network');});
  for(const [sub,url,settings,status] of [
    [null,ENDPOINT+'?store='+encodeURIComponent(NAME),env,401],
    ['not-owner',ENDPOINT+'?store='+encodeURIComponent(NAME),env,403],
    ['owner-id',ENDPOINT+'?filter=all',env,400],
    ['owner-id',ENDPOINT+'?store='+encodeURIComponent(NAME),{...env,MS_API_TOKEN:''},503],
    ['owner-id','https://evil.invalid/api/ms/warehouse-availability?store='+encodeURIComponent(NAME),env,400]
  ]){
    const response=await h({request:await req(sub,url),env:settings});
    assert.equal(response.status,status);
  }
  const post=await h({request:new Request(ENDPOINT,{method:'POST'}),env});
  assert.equal(post.status,405);
  assert.equal(calls,0);
});

test('upstream errors at each stage contain only http and fixed error codes',async()=>{
  for(const at of [1,2,3]){
    let count=0;
    const h=createWarehouseAvailabilityHandler(async()=>{
      count++;
      if(count===at)return new Response('secret vendor private SKU',{status:429});
      if(count===1)return answer(stores);
      if(count===2)return answer(stock);
      return answer(assort);
    });
    const result=await h({request:await req(),env});
    assert.equal(result.status,502);
    const body=await result.text();
    assert.equal(JSON.parse(body).upstreamHttp,429);
    assert.equal(JSON.parse(body).code,'ms_rate_limited');
    assert.equal(JSON.parse(body).upstream,['stores','current','assortment'][at-1]);
    assert.equal(count,at);
    assert.doesNotMatch(body,/secret|vendor|SKU|synthetic-access-token/);
  }
});
