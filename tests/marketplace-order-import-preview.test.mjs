import test from 'node:test';
import assert from 'node:assert/strict';
import {externalKey,normalizeMarketplaceOrders,buildOzonFbsPreviewBody,lookupMoyskladDuplicate,scanMoyskladOrderKeys,matchMoyskladArticles,classifyMarketplaceOrder,createMarketplaceOrderPreview}
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

test('exact SKU article match requires one exact source record',async()=>{
  const sku='VESTA-01';
  const orders=[{items:[{sku,quantity:1}]}];
  const calls=[];
  const res=await matchMoyskladArticles(async(url,options)=>{
    calls.push({url,headers:options.headers});
    return Response.json({meta:{size:1},rows:[{article:sku}]});
  },'test-token',orders);
  assert.equal(res.bySku.get(sku),'matched_exact_article');
  assert.equal(res.requests,1);
  assert.equal(calls[0].headers.Accept,'application/json;charset=utf-8');
  assert.equal(new URL(calls[0].url).searchParams.get('filter'),'article='+sku);
});
test('article ambiguity and API failures cannot be treated as matched',async()=>{
  const orders=[{items:[{sku:'A',quantity:1},{sku:'B',quantity:1},
    {sku:'C',quantity:1}]}];
  const res=await matchMoyskladArticles(async(url)=>{
    const sku=new URL(url).searchParams.get('filter');
    if(sku==='article=A')
      return Response.json({meta:{size:2},rows:[{article:'A'},{article:'A'}]});
    if(sku==='article=B')return Response.json({meta:{size:0},rows:[]});
    return new Response('{}',{status:400});
  },'test-token',orders);
  assert.equal(res.bySku.get('A'),'unverified');
  assert.equal(res.bySku.get('B'),'not_matched');
  assert.equal(res.bySku.get('C'),'unverified');
});
