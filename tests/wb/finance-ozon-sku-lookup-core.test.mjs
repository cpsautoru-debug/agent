import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveOzonProfitMissingSkus,validateOzonSellerProductInfo}
  from '../../web/office/finance-ozon-sku-lookup-core.mjs';
const profit=[
  {sku:'1606894548'},{sku:'1606894548'},
  {sku:'1710475340'},{sku:'1234567890'},{sku:'LEGACY-CODE'}
];
const catalog=[{sku:'1234567890'}];
test('deduplicates dated cost versions and looks up only absent decimal SKU',()=>{
  const r=deriveOzonProfitMissingSkus(profit,catalog);
  assert.equal(r.profitUniqueCount,4);
  assert.equal(r.missingCount,3);
  assert.deepEqual(r.skus,['1606894548','1710475340']);
  assert.deepEqual(r.unsupported,['LEGACY-CODE']);
  assert.equal(r.skippedNonNumeric,1);
});
test('recognizes requested returned numeric SKU and refuses invented identities',()=>{
  const req=['1606894548','1710475340'];
  const raw={items:[
    {sku:1606894548,name:'Авточехлы Lada Priora',
      offer_id:'pr-sedan',id:7321,is_archived:false},
    {sku:9999,name:'Unrelated product',offer_id:'evil'},
  ]};
  const r=validateOzonSellerProductInfo(raw,req);
  assert.equal(r.foundCount,1);
  assert.equal(r.items[0].sku,'1606894548');
  assert.equal(r.items[0].name,'Авточехлы Lada Priora');
  assert.equal(r.items[0].offerId,'pr-sedan');
  assert.equal(r.items[0].physicalIdentityVerified,false);
  assert.equal(r.items[0].costTransferred,false);
  assert.deepEqual(r.notFound,['1710475340']);
});
test('rejects duplicate returned identifiers and empty seller article',()=>{
  assert.throws(()=>validateOzonSellerProductInfo({items:[
    {sku:1606894548,name:'A',offer_id:'one'},
    {sku:1606894548,name:'B',offer_id:'two'}
  ]},['1606894548']),/ozon_seller_products_invalid/);
  assert.throws(()=>validateOzonSellerProductInfo({items:[
    {sku:1606894548,name:'Name',offer_id:''}
  ]},['1606894548']),/ozon_seller_products_invalid/);
});
test('source limits and malformed response fail closed, no implicit pricing',()=>{
  assert.throws(()=>deriveOzonProfitMissingSkus(
    [{sku:'123'},{sku:'123'}],[{sku:'abc'},{sku:'abc'}]
  ));
  assert.throws(()=>deriveOzonProfitMissingSkus(
    Array.from({length:101},(_,i)=>({sku:String(i+100)})),[],100
  ),/ozon_sku_lookup_limit/);
  assert.throws(()=>validateOzonSellerProductInfo(
    {results:{items:[]}},['123']
  ),/ozon_seller_products_invalid/);
  assert.throws(()=>validateOzonSellerProductInfo(
    {items:[]},['1','1']
  ));
});
