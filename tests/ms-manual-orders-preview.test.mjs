import test from 'node:test';
import assert from 'node:assert/strict';
import {manualOrderChannel,normalizeManualCustomerOrder} from '../functions/api/ms/manual-orders-preview.js';

const id='cfd25ff1-1ac3-11f1-0a80-16a500223fe0';
const validRow={
 id:'72856218-01ac-11f1-0a80-16a500223fe0',
 name:'00042',externalCode:'AS63:manual:avito:AV-20261125-001',
 moment:'2026-11-25 10:00:00',
 state:{name:'Новый',stateType:'Regular'},
 organization:{name:'ООО АвтоСклад63'},store:{name:'Основной склад'},
 positions:[{assortment:{name:'Комплект чехлов',article:'VESTA-BLK',
  meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+id}},
  quantity:1}]
};

test('manual channel requires an exact supported prefix and unique reference',()=>{
 assert.deepEqual(manualOrderChannel('AS63:manual:avito:AV-20261125-001'),
  {key:'avito',label:'Авито',orderRef:'AV-20261125-001'});
 assert.equal(manualOrderChannel('notes AS63:manual:avito:AV-20261125-001'),null);
 assert.equal(manualOrderChannel('AS63:manual:avito:'),null);
 assert.equal(manualOrderChannel('AS63:manual:dealer_other:X-1'),null);
});

test('manual customer order preserves the exact MoySklad item UUID',()=>{
 const result=normalizeManualCustomerOrder(validRow);
 assert.equal(result.source,'avito');
 assert.equal(result.manualOrderRef,'AV-20261125-001');
 assert.equal(result.items[0].itemId,id);
 assert.equal(result.items[0].article,'VESTA-BLK');
 assert.equal(result.items[0].quantity,1);
 assert.equal(result.statusType,'Regular');
});

test('unverified assortment types and invalid quantities are rejected',()=>{
 const wrong={...validRow,positions:[{...validRow.positions[0],
  assortment:{...validRow.positions[0].assortment,
   meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/service/'+id}}}]};
 assert.throws(()=>normalizeManualCustomerOrder(wrong),/manual_order_position_unverified/);
 assert.throws(()=>normalizeManualCustomerOrder({...validRow,positions:[
  {...validRow.positions[0],quantity:-1}]}),/manual_order_position_unverified/);
});

test('Plamya channel has an exact independent marker and MoySklad UUID identity',()=>{
 const row={...validRow,externalCode:'AS63:manual:plamya:PL-20261125-001'};
 const order=normalizeManualCustomerOrder(row);
 assert.equal(order.source,'plamya');
 assert.equal(order.sourceLabel,'Пламя · точка');
 assert.equal(order.orderIdentity,'AS63:manual:plamya:'+row.id);
 assert.equal(order.items[0].itemId,id);
 assert.equal(manualOrderChannel('AS63:manual:plamya:'),null);
});
test('document without a manual marker is excluded',()=>{
 assert.throws(()=>normalizeManualCustomerOrder({...validRow,externalCode:'ordinary-order-123'}),
  /manual_order_schema_unverified/);
});
