import test from 'node:test';
import assert from 'node:assert/strict';
import {externalKey,normalizeMarketplaceOrders,buildOzonFbsPreviewBody,lookupMoyskladDuplicate,scanMoyskladOrderKeys,matchMoyskladArticles,matchMoyskladArticlesBudgeted,fetchOzonProductEvidence,findMoyskladNameSuggestion,barcodeValues,matchMoyskladOzonBarcodes,verifyExactAssortmentSku,probeExactAssortmentSku,classifyMarketplaceOrder,createMarketplaceOrderPreview,extractOzonOrderPage}
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
    sku:'VESTA-01',quantity:2,assortmentVerified:false,transaction:{amountMinor:null,currency:null,basis:'ozon_posting_product_price'}}]);
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
  assert.equal(payload.limit,50);
  assert.equal('dir' in payload,false);
  assert.equal(payload.filter.since,'2026-11-16T10:00:00.000Z');
  assert.equal(payload.filter.to,'2026-11-23T10:00:00.000Z');
});

test('Ozon FBS intake follows cursor pages and rejects partial page coverage',async()=>{
 const {createSession}=await import('../functions/api/auth/session.js');
 const base='https://autosklad63-office-staging.pages.dev/api/marketplace/order-import-preview?source=ozon';
 const cookie=(await createSession('owner','test-yandex-session')).split(';')[0];
 const calls=[];
 const env={OFFICE_SESSION_SECRET:'test-yandex-session',OFFICE_ALLOWED_EMAIL:'owner@example.test',
  OZON_FINANCE_DB:{prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})},
  OZON_API_KEY:'test-ozon',OZON_CLIENT_ID:'1001',MS_API_TOKEN:'test-ms'};
 const handler=createMarketplaceOrderPreview({fetcher:async(url,opts)=>{
  const u=new URL(url);calls.push({url,method:opts.method,body:opts.body});
  if(u.hostname==='api-seller.ozon.ru'&&u.pathname==='/v4/posting/fbs/list'){
   const body=JSON.parse(opts.body);
   assert.equal(body.limit,50);
   return Response.json(body.cursor?{postings:[{posting_number:'P2',status:'awaiting_packaging',products:[{offer_id:'SKU2',quantity:1}]}],has_next:false,cursor:''}:
    {postings:[{posting_number:'P1',status:'awaiting_packaging',products:[{offer_id:'SKU1',quantity:1}]}],has_next:true,cursor:'next'});
  }
  if(u.hostname==='api-seller.ozon.ru'&&u.pathname==='/v3/product/info/list')
   return Response.json({items:[{offer_id:'SKU1',barcodes:[]},{offer_id:'SKU2',barcodes:[]}]});
  if(u.hostname==='api.moysklad.ru'&&u.pathname.endsWith('/entity/customerorder'))
   return Response.json({meta:{size:0},rows:[]});
  if(u.hostname==='api.moysklad.ru'&&u.pathname.endsWith('/entity/assortment'))
   return Response.json({meta:{size:0},rows:[]});
  throw Error('unexpected_api_call');
 }});
 const res=await handler({request:new Request(base,{headers:{Cookie:cookie}}),env});
 const data=await res.json();
 assert.equal(res.status,200);assert.equal(data.complete,true);
 assert.equal(data.coverage,'FBS_AWAITING_PACKAGING_LAST_7_DAYS_COMPLETE');
 assert.equal(data.orders.length,2);
 assert.equal(data.orders[0].externalKey,'AS63:ozon:1001:P1');
 const fbs=calls.filter(x=>x.url.includes('/v4/posting/fbs/list'));
 assert.equal(fbs.length,2);
 assert.equal(JSON.parse(fbs[1].body).cursor,'next');
 assert.ok(calls.filter(x=>x.url.includes('moysklad.ru')).every(x=>x.method==='GET'));
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

test('exact SKU probe gives safe categorical evidence when filters are blocked',async()=>{
  const calls=[];
  const out=await probeExactAssortmentSku(async(url)=>{
    calls.push(new URL(url).searchParams.get('filter'));
    return new Response('{"errors":[{"error":"sensitive message"}]}',{status:400});
  },'mock-token','24086');
  assert.deepEqual(calls,['article=24086']);
  assert.deepEqual(out,{match:'unverified',
    fields:{article:'filter_rejected',code:'not_checked'}});
  assert.equal(JSON.stringify(out).includes('sensitive'),false);
});
test('exact SKU probe shows absent article and single matching code',async()=>{
  const out=await probeExactAssortmentSku(async url=>
    new URL(url).searchParams.get('filter')==='article=24086'?
      Response.json({meta:{size:0},rows:[]}):
      Response.json({meta:{size:1},rows:[{id:'one',code:'24086'}]})
  ,'mock-token','24086');
  assert.equal(out.match,'matched_exact_code');
  assert.equal(out.fields.article,'absent_exact');
  assert.equal(out.fields.code,'one_exact');
});

test('live preview probes at most two SKUs and never does bulk scan',async()=>{
  const calls=[];
  const orders=[{items:[{sku:'A',quantity:1},{sku:'B',quantity:1},
    {sku:'C',quantity:1}]}];
  const r=await matchMoyskladArticlesBudgeted(async(url)=>{
    calls.push(new URL(url));
    return Response.json({meta:{size:0},rows:[]});
  },'test-token',orders);
  assert.equal(calls.length,4);
  assert.ok(calls.every(u=>u.searchParams.has('filter')));
  assert.ok(calls.every(u=>!u.searchParams.has('offset')));
  assert.equal(r.bySku.get('C'),'unverified');
  assert.equal(r.coverage.pages,0);
  assert.equal(r.coverage.mode,'TARGETED_ONLY_TO_AVOID_RATE_LIMITS');
});
test('live preview stops following first rate-limited SKU',async()=>{
  const calls=[];
  const r=await matchMoyskladArticlesBudgeted(async(url)=>{
    calls.push(new URL(url).searchParams.get('filter'));
    return new Response('{}',{status:429});
  },'test-token',[{items:[{sku:'A',quantity:1},
    {sku:'B',quantity:1}]}]);
  assert.deepEqual(calls,['article=A']);
  assert.equal(r.coverage.failureCode,'rate_limited');
  assert.equal(r.bySku.get('B'),'unverified');
});

test('Ozon catalog evidence retrieves offer ID and barcode without assuming MoySklad match',async()=>{
  const calls=[];
  const result=await fetchOzonProductEvidence(async(url,opt)=>{
    calls.push({url,method:opt.method,payload:JSON.parse(opt.body)});
    return Response.json({items:[
      {offer_id:'24086',id:13579,barcodes:['4601234567890','4601234567890']},
      {offer_id:'24703',id:24680,barcodes:[]}
    ]});
  },'1001','test-token',[
    {items:[{sku:'24086',quantity:1},{sku:'24703',quantity:1}]},
    {items:[{sku:'24086',quantity:1}]}
  ]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api-seller.ozon.ru/v3/product/info/list');
  assert.deepEqual(calls[0].payload,{offer_id:['24086','24703']});
  assert.equal(result.code,'ok');
  assert.equal(result.byOffer.get('24086').status,'seller_product_with_barcode');
  assert.deepEqual(result.byOffer.get('24086').barcodes,['4601234567890']);
  assert.equal(result.byOffer.get('24703').status,'seller_product_without_barcode');
});
test('Ozon catalog ambiguous product IDs are never accepted as evidence',async()=>{
  const x=await fetchOzonProductEvidence(async()=>Response.json({items:[
    {offer_id:'24086',id:11,barcodes:['4601234567890']},
    {offer_id:'24086',id:12,barcodes:['4601234567891']}
  ]}),'1001','test-token',[{items:[{sku:'24086',quantity:1}]}]);
  assert.equal(x.byOffer.get('24086').status,'ambiguous');
  assert.deepEqual(x.byOffer.get('24086').barcodes,[]);
});
test('Ozon product lookup API unavailable does not block zero-write preview',async()=>{
  const x=await fetchOzonProductEvidence(async()=>new Response('{}',{status:403}),
    '1001','test-token',[{items:[{sku:'24086',quantity:1}]}]);
  assert.equal(x.code,'permission_denied');
  assert.equal(x.byOffer.get('24086').status,'not_confirmed');
});

test('MoySklad barcode evidence matches exactly one item and verifies raw barcode',async()=>{
  const requests=[];
  const r=await matchMoyskladOzonBarcodes(async(url,opts)=>{
    requests.push({url,accept:opts.headers.Accept});
    return Response.json({meta:{size:1},rows:[
      {id:'some-ms-item',barcodes:[{ean13:'OZN3559279106'}]}
    ]});
  },'test-token',[{items:[{sku:'24086',ozonCatalog:{
    status:'seller_product_with_barcode',barcodes:['OZN3559279106']
  }}]}]);
  assert.equal(r.requests,1);
  assert.equal(r.bySku.get('24086'),'matched_exact_barcode');
  assert.equal(r.diagnostics[0].category,'one_exact');
  assert.equal(new URL(requests[0].url).searchParams.get('filter'),
    'barcode=OZN3559279106');
  assert.equal(requests[0].accept,'application/json;charset=utf-8');
});
test('MoySklad barcode query cannot prove match without matching barcode value',async()=>{
  const item={sku:'24086',ozonCatalog:{status:'seller_product_with_barcode',
    barcodes:['OZN3559279106']}};
  const r=await matchMoyskladOzonBarcodes(async()=>Response.json({
    meta:{size:1},rows:[{id:'different',barcodes:[{ean13:'OTHER-CODE'}]}]
  }),'test-token',[{items:[item]}]);
  assert.equal(r.bySku.get('24086'),'unverified');
});
test('MoySklad barcode checks stop immediately on 429',async()=>{
  const reqs=[];
  const x=await matchMoyskladOzonBarcodes(async(url)=>{
    reqs.push(url);return new Response('{}',{status:429});
  },'test-token',[{items:[
    {sku:'24086',ozonCatalog:{status:'seller_product_with_barcode',
      barcodes:['OZN3559279106']}},
    {sku:'24703',ozonCatalog:{status:'seller_product_with_barcode',
      barcodes:['OZN1715262287']}}
  ]}]);
  assert.equal(reqs.length,1);
  assert.equal(x.rateLimited,true);
  assert.equal(x.bySku.get('24703'),'unverified');
});

test('candidate catalog search uses Ozon title only and never asserts a mapping',async()=>{
  const requests=[];
  const out=await findMoyskladNameSuggestion(async(url,opt)=>{
    requests.push({url,method:opt.method});
    return Response.json({meta:{size:1},rows:[
      {id:'some-moysklad-id',name:'Авточехлы Vesta оригинал'}
    ]});
  },'test-token',[{items:[{sku:'24086',ozonCatalog:{
    title:'Авточехлы Vesta оригинал',status:'seller_product_with_barcode'
  }}]}]);
  assert.equal(requests.length,1);
  assert.equal(new URL(requests[0].url).searchParams.has('filter'),false);
  assert.equal(new URL(requests[0].url).searchParams.get('search'),
    'Авточехлы Vesta оригинал');
  assert.equal(out.status,'possible_candidates');
  assert.equal(out.candidates.length,1);
  assert.equal('matched' in out,false);
});
test('missing Ozon product title triggers no MoySklad search',async()=>{
  let calls=0;
  const out=await findMoyskladNameSuggestion(async()=>{calls++;},
    'test-token',[{items:[{sku:'24086',ozonCatalog:{
      status:'seller_product_without_barcode'}}]}]);
  assert.equal(calls,0);
  assert.equal(out.status,'no_product_name');
});

test('WB FBS uses dedicated read-only orders token without financial-token fallback',async()=>{
  const {createSession}=await import('../functions/api/auth/session.js');
  const url='https://autosklad63-office-staging.pages.dev/api/marketplace/order-import-preview?source=wb';
  const cookie=(await createSession('test-owner','unit-test-session-secret')).split(';')[0];
  const request=new Request(url,{headers:{Cookie:cookie}});
  const ownerDb={prepare:()=>({bind:()=>({first:async()=>({allowed:1})})})};
  const base={OFFICE_SESSION_SECRET:'unit-test-session-secret',
    OFFICE_ALLOWED_EMAIL:'owner@example.test',OZON_FINANCE_DB:ownerDb,
    MS_API_TOKEN:'ms-read-token',WB_API_TOKEN:'finance-token-must-not-be-used'};
  const calls=[];
  const handler=createMarketplaceOrderPreview({fetcher:async(url,options)=>{
    calls.push({url,authorization:options.headers?.Authorization});
    return Response.json({orders:[]});
  }});
  const missing=await handler({request,env:base});
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).code,'marketplace_credentials_missing');
  assert.equal(calls.length,0);
  const response=await handler({request,env:{
    ...base,WB_ORDERS_API_TOKEN:'dedicated-orders-token'
  }});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.source,'wb');
  assert.equal(result.readOnly,true);
  assert.equal(result.changedRecords,0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://marketplace-api.wildberries.ru/api/v3/orders/new');
  assert.equal(calls[0].authorization,'dedicated-orders-token');
});

test('Ozon FBO pagination accepts documented root schema and a complete wrapped schema',()=>{
 const rows=[{posting_number:'FBO-1'}];
 assert.deepEqual(extractOzonOrderPage({postings:rows,has_next:true,cursor:'c2'},'ozon_fbo'),
   {rows,hasNext:true,next:'c2'});
 assert.deepEqual(extractOzonOrderPage({result:{postings:rows,has_next:false,cursor:''}},'ozon_fbo'),
   {rows,hasNext:false,next:''});
 assert.throws(()=>extractOzonOrderPage({result:{postings:rows},has_next:true,cursor:'c2'},'ozon_fbo'),
   /pagination_unverified/);
 assert.deepEqual(extractOzonOrderPage({postings:rows,has_next:true,cursor:'c2'},'ozon'),
   {rows,hasNext:true,next:'c2'});
});
