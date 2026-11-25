import test from 'node:test';
import assert from 'node:assert/strict';
import { readWarehouse } from '../functions/api/orders/fulfillment-warehouse.mjs';

const id = '12345678-1234-4234-9234-1234567890ab';
const org = '12345678-1234-4234-9234-1234567890ac';
const base = 'https://api.moysklad.ru/api/remap/1.2/entity/';
const mapping = { store_id: id, organization_id: org, store_kind: 'manufacturer' };
const order = { source: 'ozon', account: 'cabinet' };

test('validates cabinet warehouse and organization by exact ID', async () => {
 const verified = await readWarehouse(order, mapping, async path => ({
  id: path.endsWith(id) ? id : org, name: 'Подтверждено'
 }));
 assert.equal(verified.status, 'warehouse_verified');
 assert.equal(verified.storeId, id);
 assert.equal(verified.source, 'cabinet_mapping');
});

test('absent mapping, a mismatched store and FBO block the warehouse', async () => {
 const unexpectedlyRead = async () => assert.fail('unexpected fetch');
 assert.equal((await readWarehouse(order, null, unexpectedlyRead)).status, 'warehouse_unverified');
 assert.equal((await readWarehouse(order, mapping, async () => ({id: org, name: 'Other'}))).status, 'warehouse_unverified');
 assert.equal((await readWarehouse({...order, source: 'ozon_fbo'}, mapping, unexpectedlyRead)).status, 'warehouse_unverified');
});

test('manual warehouse follows the exact customer order references', async () => {
 const verified = await readWarehouse({source:'plamya', ms_customerorder_id: id}, null, async path => {
  if (path === 'customerorder/' + id) return {
   id, store: {meta:{href:base+'store/'+id}}, organization:{meta:{href:base+'organization/'+org}}
  };
  return {id:path.split('/')[1], name:'Пламя'};
 });
 assert.equal(verified.source,'customerorder');
 assert.equal(verified.storeId,id);
});

