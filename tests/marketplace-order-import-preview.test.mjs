import test from 'node:test';
import assert from 'node:assert/strict';
import {externalKey,normalizeMarketplaceOrders,buildOzonFbsPreviewBody,lookupMoyskladDuplicate,scanMoyskladOrderKeys,matchMoyskladArticles,verifyExactAssortmentSku,classifyMarketplaceOrder,createMarketplaceOrderPreview}
  from '../functions/api/marketplace/order-import-preview.js';

test('external keys are stable across retries and separate account/source',()=>{
  assert.equal(externalKey('ozon','1001','123-1'),'AS63:ozon:1001:123-1');
  assert.notEqual(externalKey('ozon','1001','123-1'),
    externalKey('ozon','1002','123-1'));
  assert.throws(()=>externalKey('wb','primary','a/b'),/identity/);
});
test('Ozon v4 FBS postings normalize without ready-to-write assumption',()=>{
  const rows=normalizeMarketplaceOrders('ozon',{postings:[{
    posting_number:'123-1',status:'awaiting_packaging',
    products:[{offer_id:'VESTA-01',quantity:2}]
  }]},'1001');
  assert.equal(rows.length,1);
  assert.equal(rows[0].externalKey,'AS63:ozon:1001:123-1');
  assert.deepEqual(rows[0].items,[{
    sku:'VESTA-01',quantity:2,assortmentVerified:false}]);
  assert.equal(rows[0].readyToWrite,false);
  assert.equal(rows[0].legalEntityVerified,false);
});
test('WB new FBS assembly order normalizes without customer PII',()=>{
  const rows=normalizeMarketplaceOrders('wb',{orders:[{
    id:12345,article:'PRIORA-001',price:500000,
    address:'should never be shown'
  }]},'wb-primary');
  assert.equal(rows[0].externalKey,'AS63:wb:wb-primary:12345');
  assert.equal(rows[0].status,'new_fbs_assembly_order');
  assert.equal(JSON.stringify(rows).includes('address'),false);
});
test('empty feed stays empty and malformed orders fail closed',()=>{
  assert.deepEqual(normalizeMarketplaceOrders('wb',{orders:[]},'wb-primary'),[]);
  assert.throws(()=>normalizeMarketplaceOrders('ozon',{result:{postings:[]}},'1001'),/feed/);
  assert.throws(()=>normalizeMarketplaceOrders('wb',{orders:[
    {id:1,article:'A'},{id:1,article:'B'}
  ]},'wb-primary'),/duplicate_source_order/);
  assert.throws(()=>normalizeMarketplaceOrders('wb',{orders:[
    {id:1,article:''}
  ]},'wb-primary'),/unmapped_order_line/);
});
test('cannot invoke live fetch without owner authentication',async()=>{
  const handler=createMarketplaceOrderPreview({fetcher:()=>{
    throw Error('must not fetch without authorization');
  }});
  const url='https://autosklad63-office-staging.pages.dev/api/marketplace/order-import-preview?source=ozon';
  const response=await handler({request:new Request(url),env:{}});
  assert.equal(response.status,503);
  const wrong=await handler({request:new Request(url+'&write=true'),env:{}});
  assert.equal(wrong.status,400);
});

test('Ozon FBS v4 request uses documented cursor and sort_dir',()=>{
  const payload=buildOzonFbsPreviewBody(Date.parse('2026-11-23T10:00:00.000Z'));
  assert.equal(payload.sort_dir,'DESC');
  assert.equal(payload.cursor,'');
  assert.deepEqual(payload.filter.statuses,['awaiting_packaging']);
  assert.equal(payload.limit,10);
  assert.equal('dir' in payload,false);
  assert.equal(payload.filter.since,'2026-11-16T10:00:00.000Z');
  assert.equal(payload.filter.to,'2026-11-23T10:00:00.000Z');
});

test('MoySklad filter 400 falls back without claiming absence of a duplicate',async()=>{
  const urls=[];
  const fetcher=async url=>{
    urls.push(url);
    if(url.includes('filter='))return new Response('{}',{status:400});
    return Response.json({meta:{size:0},rows:[]});
  };
  const result=await lookupMoyskladDuplicate(fetcher,'test-token','AS63:ozon:123:A-1');
  assert.deepEqual(result,{status:'unverified',method:'context_search',queries:2});
  assert.equal(urls.length,2);
  assert.match(urls[1],/search=/);
});
test('exact MoySklad externalCode match is recognized as existing',async()=>{
  const key='AS63:ozon:123:A-1';
  const fetcher=async()=>Response.json({meta:{size:1},rows:[{externalCode:key}]});
  const result=await lookupMoyskladDuplicate(fetcher,'test-token',key);
  assert.equal(result.status,'already_exists');
  assert.equal(result.method,'exact_filter');
});
test('empty exact MoySklad filter is distinct from uncertain fallback',async()=>{
  const fetcher=async()=>Response.json({meta:{size:0},rows:[]});
  const result=await lookupMoyskladDuplicate(fetcher,'test-token','AS63:wb:primary:123');
  assert.equal(result.status,'not_found');
});

test('MoySklad search rejected twice does not invent absence of duplicates',async()=>{
  const key='AS63:ozon:123:A-1';
  let count=0;
  const result=await (async()=>{
    try{
      await lookupMoyskladDuplicate(async()=>{count++;
        return new Response('{}',{status:400});
      },'test-token',key);
    }catch(error){return {status:error.status,queries:count};}
  })();
  assert.deepEqual(result,{status:400,queries:2});
});

test('bounded customerorder list scan finds exact duplicate without unsupported filters',async()=>{
  const key='AS63:ozon:123:A-1';
  const requests=[];
  const scan=await scanMoyskladOrderKeys(async url=>{
    requests.push(new URL(url));
    return Response.json({meta:{size:2},rows:[
      {externalCode:'unrelated'},{externalCode:key}
    ]});
  },'test-token',[key]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].searchParams.get('limit'),'25');
  assert.equal(requests[0].searchParams.get('offset'),'0');
  assert.equal(requests[0].searchParams.has('filter'),false);
  assert.equal(scan.complete,true);
  assert.equal(scan.matches.get(key),1);
});
test('bounded customerorder scan never asserts missing record if truncated',async()=>{
  const key='AS63:wb:wb-primary:222';
  const scan=await scanMoyskladOrderKeys(async url=>{
    const offset=Number(new URL(url).searchParams.get('offset'));
    return Response.json({meta:{size:500},rows:Array.from({length:25},(_,i)=>({
      externalCode:'other-'+(offset+i)
    }))});
  },'test-token',[key]);
  assert.equal(scan.complete,false);
  assert.equal(scan.checkedRows,200);
  assert.equal(scan.pages,8);
  assert.equal(scan.matches.get(key),0);
});
test('scan failure after one page retains partial match with incomplete evidence',async()=>{
  const key='AS63:ozon:123:B-1';
  let n=0;
  const scan=await scanMoyskladOrderKeys(async()=>{
    n++;
    if(n>1)return new Response('{}',{status:400});
    return Response.json({meta:{size:100},rows:Array.from({length:25},(_,i)=>({
      externalCode:i===2?key:'other-'+i
    }))});
  },'test-token',[key,'AS63:ozon:123:NOT-IN-PAGE']);
  assert.equal(scan.complete,false);
  assert.equal(scan.sourceError,true);
  assert.equal(scan.matches.get(key),1);
});

test('Ozon lifecycle never dispatches delivered, delivering, shipping or cancelled postings',()=>{
  for(const state of ['cancelled','delivered','delivering','awaiting_deliver',
    'driver_pickup','not_accepted']){
    assert.equal(classifyMarketplaceOrder('ozon',state).queue,'not_for_sewing');
  }
  assert.equal(classifyMarketplaceOrder('ozon','awaiting_packaging').queue,
    'candidate_needs_inventory');
  assert.equal(classifyMarketplaceOrder('ozon','unrecognized_state').queue,
    'unverified');
});
test('Ozon read-only preview flags cancelled shipment as not for sewing',()=>{
  const order=normalizeMarketplaceOrders('ozon',{postings:[{
    posting_number:'123-1',status:'cancelled',
    products:[{offer_id:'VESTA',quantity:1}]
  }]},'1001')[0];
  assert.equal(order.productionQueue,'not_for_sewing');
  assert.equal(order.readyToWrite,false);
});

test('mixed shipped status cannot enter Ozon new-order preview',()=>{
  const raw={postings:[{posting_number:'123-1',status:'delivering',
    products:[{offer_id:'VESTA',quantity:1}]}]};
  const orders=normalizeMarketplaceOrders('ozon',raw,'1001');
  assert.equal(orders[0].productionQueue,'not_for_sewing');
  assert.equal(orders[0].readyToWrite,false);
});

test('Ozon FBO shipments are read-only and never counted as sewing jobs',()=>{
  const result=normalizeMarketplaceOrders('ozon_fbo',{result:{postings:[{
    posting_number:'FBO-2026-1',status:'delivered',
    products:[{offer_id:'VESTA-READY',quantity:1}]
  }]}},'123');
  assert.equal(result.length,1);
  assert.equal(result[0].supplyScheme,'FBO');
  assert.equal(result[0].productionQueue,'not_for_sewing');
  assert.equal(result[0].readyToWrite,false);
  assert.equal(result[0].externalKey,'AS63:ozon_fbo:123:FBO-2026-1');
});

test('MoySklad duplicate requests send exact JSON UTF-8 Accept header',async()=>{
  const key='AS63:ozon:123:A-1';
  const accepts=[];
  const fetcher=async(_url,opts)=>{
    accepts.push(opts.headers.Accept);
    return Response.json({meta:{size:0},rows:[]});
  };
  await lookupMoyskladDuplicate(fetcher,'test-token',key);
  await scanMoyskladOrderKeys(fetcher,'test-token',[key]);
  assert.deepEqual(accepts,[
    'application/json;charset=utf-8',
    'application/json;charset=utf-8'
  ]);
});

test('complete assortment scan matches unique article and code',async()=>{
  const source=[{id:'1',article:'VESTA-01'}, {id:'2',code:'24086'}];
  const seen=[];
  const scan=await matchMoyskladArticles(async(url,options)=>{
    seen.push({url,accept:options.headers.Accept});
    return Response.json({meta:{size:2},rows:source});
  },'test-token',[{items:[{sku:'VESTA-01',quantity:1},
    {sku:'24086',quantity:1},{sku:'NOT-THERE',quantity:1}]}]);
  assert.equal(scan.bySku.get('VESTA-01'),'matched_exact_article');
  assert.equal(scan.bySku.get('24086'),'matched_exact_code');
  assert.equal(scan.bySku.get('NOT-THERE'),'not_matched');
  assert.equal(scan.coverage.complete,true);
  assert.equal(scan.requests,1);
  assert.equal(seen[0].accept,'application/json;charset=utf-8');
  assert.equal(new URL(seen[0].url).searchParams.get('limit'),'20');
  assert.equal(new URL(seen[0].url).searchParams.has('filter'),false);
});
test('partial assortment scan does not claim a unique match or no-match',async()=>{
  const scan=await matchMoyskladArticles(async url=>{
    const offset=Number(new URL(url).searchParams.get('offset'));
    return Response.json({meta:{size:1200},rows:Array.from({length:20},
      (_,i)=>({id:String(offset+i),code:offset+i===2?'24086':'OTHER-'+(offset+i)}))});
  },'test-token',[{items:[{sku:'24086',quantity:1},
    {sku:'UNKNOWN',quantity:1}]}]);
  assert.equal(scan.coverage.complete,false);
  assert.equal(scan.coverage.checkedRows,600);
  assert.equal(scan.bySku.get('24086'),'unverified');
  assert.equal(scan.bySku.get('UNKNOWN'),'unverified');
});
test('duplicate cross-field matches cannot be treated as one SKU',async()=>{
  const result=await matchMoyskladArticles(async()=>Response.json({
    meta:{size:2},rows:[
      {id:'a',article:'24086'}, {id:'b',code:'24086'}
    ]}), 'test-token',[{items:[{sku:'24086',quantity:1}]}]);
  assert.equal(result.bySku.get('24086'),'unverified');
});
test('assortment API failure leaves SKU mapping unverified',async()=>{
  const result=await matchMoyskladArticles(async()=>new Response('{}',
    {status:400}),'test-token',[{items:[{sku:'24086',quantity:1}]}]);
  assert.equal(result.bySku.get('24086'),'unverified');
  assert.equal(result.coverage.complete,false);
  assert.equal(result.coverage.sourceError,true);
  assert.equal(result.coverage.failureCode,'upstream_http_error');
});
test('oversized first assortment response reports failure rather than absence',async()=>{
  const result=await matchMoyskladArticles(async()=>Response.json({
    meta:{size:1},rows:[{id:'a',name:'x'.repeat(300000)}]
  }), 'test-token',[{items:[{sku:'24086',quantity:1}]}]);
  assert.equal(result.coverage.pages,0);
  assert.equal(result.coverage.failureCode,'response_too_large');
  assert.equal(result.bySku.get('24086'),'unverified');
});

test('exact filtered SKU validates both fields for the same product id',async()=>{
  const sku='24086';
  const calls=[];
  const found=await verifyExactAssortmentSku(async url=>{
    const filter=new URL(url).searchParams.get('filter');calls.push(filter);
    return Response.json(filter==='article=24086'?
      {meta:{size:0},rows:[]}:
      {meta:{size:1},rows:[{id:'item-123',code:sku}]});
  },'test-token',sku);
  assert.equal(found,'matched_exact_code');
  assert.deepEqual(calls,['article=24086','code=24086']);
});
test('exact filtered SKU remains unverified if a different item shares code',async()=>{
  const found=await verifyExactAssortmentSku(async url=>{
    const field=new URL(url).searchParams.get('filter').split('=')[0];
    return Response.json({meta:{size:1},rows:[
      {id:field==='article'?'item-one':'item-two',[field]:'24086'}
    ]});
  },'test-token','24086');
  assert.equal(found,'unverified');
});
test('failed second SKU filter must not confirm first filter positive',async()=>{
  const found=await verifyExactAssortmentSku(async url=>{
    if(new URL(url).searchParams.get('filter').startsWith('code='))
      return new Response('{}',{status:403});
    return Response.json({meta:{size:1},rows:[
      {id:'item-one',article:'24086'}]});
  },'test-token','24086');
  assert.equal(found,'unverified');
});
test('partial assortment scan may verify exact positive SKU but not absence',async()=>{
  const result=await matchMoyskladArticles(async url=>{
    const u=new URL(url),filter=u.searchParams.get('filter');
    if(filter==='article=24086')return Response.json({meta:{size:0},rows:[]});
    if(filter==='code=24086')return Response.json({meta:{size:1},rows:[{id:'42',code:'24086'}]});
    if(filter)return Response.json({meta:{size:0},rows:[]});
    return Response.json({meta:{size:1000},rows:Array.from({length:20},(_,i)=>
      ({id:'page-'+u.searchParams.get('offset')+'-'+i,code:'unrelated'}))});
  },'test-token',[{items:[{sku:'24086',quantity:1},
    {sku:'not-present',quantity:1}]}]);
  assert.equal(result.coverage.complete,false);
  assert.equal(result.bySku.get('24086'),'matched_exact_code');
  assert.equal(result.bySku.get('not-present'),'unverified');
  assert.equal(result.coverage.confirmedByFilter,1);
});
