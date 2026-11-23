import test from 'node:test';
import assert from 'node:assert/strict';
import {externalKey,normalizeMarketplaceOrders,buildOzonFbsPreviewBody,lookupMoyskladDuplicate,scanMoyskladOrderKeys,createMarketplaceOrderPreview}
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
