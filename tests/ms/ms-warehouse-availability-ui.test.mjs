import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-warehouse-availability.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');

test('manual one-warehouse availability is a separate labelled read-only view',()=>{
  for(const id of [
    'msWarehouseAvailabilityRefresh','msWarehouseAvailabilityStatus',
    'msWarehouseAvailabilitySummary','msWarehouseAvailabilityTable',
    'msWarehouseAvailabilityRows'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/Наличие на выбранном складе/);
  assert.match(html,/Нулевые товары, резервы и ожидание в него не входят/);
  assert.match(html,/src="ms-warehouse-availability\.mjs"/);
  assert.match(css,/\.ms-warehouse-availability/);
});
test('button makes only an owner-session same-origin GET, never background API polls',()=>{
  assert.match(js,/button\.addEventListener\('click',async\(\)=>/);
  assert.match(js,/new URLSearchParams\(\{store\}\)/);
  assert.match(js,/\/api\/ms\/warehouse-availability/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/method:'GET'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/warehouseLines/);
  assert.match(js,/additionalRows/);
  assert.match(js,/Не указана/);
  assert.match(js,/ms-stock-negative/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|setInterval|setTimeout|method:'POST'/);
});
test('results never claim physical reconciliation or full product inventory',()=>{
  assert.match(html,/не подтверждение физической инвентаризации/);
  assert.match(js,/scope!=='WAREHOUSE_NONZERO_POSITIONS_ONLY_NOT_FULL_INVENTORY'/);
  assert.match(js,/НЕ полная инвентаризация/);
  assert.match(js,/Неизвестно/);
});
