import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-warehouse-snapshot.mjs',import.meta.url),'utf8');
const view=readFileSync(new URL('../../web/office/ms-warehouse-snapshot-view.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');
test('single-click stock dashboard has independent store choice and filters',()=>{
  for(const id of [
    'msWarehouseSnapshotLoad','msWarehouseSnapshotStore',
    'msWarehouseSnapshotStatus','msWarehouseSnapshotCount',
    'msWarehouseSnapshotCategory','msWarehouseSnapshotTable',
    'msWarehouseSnapshotRows'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  for(const store of ['Пламя. Магазин','Основной склад (Цех)',
    'Склад ЕВА','Склад материалов — внешний'])
    assert.ok(html.includes('value="'+store+'"'),store);
  assert.match(html,/Собрать обзор склада/);
  assert.match(html,/До 40 позиций с ненулевым остатком/);
  assert.match(html,/Коврики/);
  assert.match(html,/src="ms-warehouse-snapshot\.mjs"/);
  assert.match(css,/\.ms-warehouse-snapshot/);
});
test('only direct manual interaction makes protected single snapshot GET',()=>{
  assert.match(js,/button\.addEventListener\('click',async\(\)=>/);
  assert.match(js,/\/api\/ms\/warehouse-snapshot/);
  assert.match(js,/method:'GET'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/new URLSearchParams\(\{store:chosen\}\)/);
  assert.match(js,/data\.completeForCurrentReport===true/);
  assert.match(js,/data\.itemCount===data\.warehouseLines/);
  assert.match(js,/data\.namesResolved===data\.itemCount/);
  assert.match(js,/data\.warehouseName===store\.value/);
  assert.doesNotMatch(js,/setInterval|localStorage|sessionStorage|innerHTML|method:'POST'/);
});
test('category changes use loaded snapshot and must not call API',()=>{
  assert.match(js,/category\.addEventListener\('change',\(\)=>\{if\(snapshot&&!pending\)render\(\);\}\)/);
  assert.match(js,/filterSnapshotItems\(snapshot\.items,category\.value\)/);
  assert.match(js,/snapshotCounts\(snapshot\.items\)/);
  assert.match(view,/коврики ева пресс форма/);
  assert.match(js,/НЕ полная инвентаризация/);
  assert.match(html,/не инвентаризация всех нулевых товаров/);
  assert.match(js,/Нет|Неизвестно/);
});
