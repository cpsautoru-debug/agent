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
    'msWarehouseAvailabilityRows','msWarehouseAvailabilityPrev',
    'msWarehouseAvailabilityNext','msWarehouseAvailabilityPage'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/Наличие на выбранном складе/);
  assert.match(html,/Нулевые товары, резервы и ожидание в него не входят/);
  assert.match(html,/src="ms-warehouse-availability\.mjs"/);
  assert.match(css,/\.ms-warehouse-availability/);
});
test('button makes only an owner-session same-origin GET, never background API polls',()=>{
  assert.match(js,/button\.addEventListener\('click',\(\)=>/);
  assert.match(js,/next\.addEventListener\('click'/);
  assert.match(js,/prev\.addEventListener\('click'/);
  assert.match(js,/q\.set\('page',String\(pageIndex\)\)/);
  assert.match(js,/data\.hasNext/);
  assert.match(js,/data\.hasPrevious/);
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

test('warehouse UI explicitly shows source catalog group or unknown, never guesses it',()=>{
  assert.match(html,/Группа в каталоге/);
  assert.match(html,/не автоматически готовой продукцией/);
  assert.match(js,/item\.catalogPath/);
  assert.match(js,/Группа не указана/);
  assert.doesNotMatch(js,/includes\('Экокожа'\)|includes\('Коврик'\)/);
});

test('materials filter is bound to a source catalog group and current page only',()=>{
  assert.equal((html.match(/id="msWarehouseCatalogFilter"/g)||[]).length,1);
  assert.equal((html.match(/id="msWarehouseCatalogStatus"/g)||[]).length,1);
  assert.match(html,/Материалы из подтверждённой группы/);
  assert.match(html,/ПРОИЗВОДСТВО\/Экокожа и Алька/);
  assert.match(html,/Фильтр относится только к загруженной странице/);
  assert.match(js,/from '\.\/ms-materials-by-catalog\.mjs'/);
  assert.match(js,/selectCatalogPage\(lastPayload\.items,catalogFilter\.value\)/);
  assert.match(js,/countCatalogPageEvidence\(lastPayload\.items\)/);
  assert.match(js,/catalogFilter\.addEventListener\('change'/);
  assert.match(js,/if\(loaded&&!pending\)renderItems\(\)/);
  assert.match(js,/lastPayload=data/);
  assert.match(js,/CURRENT_API_PAGE_ONLY|Только текущая страница/);
  assert.match(js,/нет товаров среди загруженных позиций/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|setInterval/);
});
