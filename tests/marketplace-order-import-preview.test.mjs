import test from 'node:test';
import assert from 'node:assert/strict';
import {externalKey,normalizeMarketplaceOrders,createMarketplaceOrderPreview}
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
