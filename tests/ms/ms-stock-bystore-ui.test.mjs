import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-stock-bystore.mjs',import.meta.url),'utf8');
const prod=readFileSync(new URL('../../web/office/ms-production.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');
test('actual warehouse report and executive summary appear in production, not in demo panels',()=>{
  const fragment=html.split('<!-- ПРОИЗВОДСТВО -->')[1]?.split('</section>\n\n    <footer>')[0];
  assert.ok(fragment);
  for(const id of [
    'msExecutiveTasks','msExecutiveAudit','msExecutiveStock','msStockSection',
    'msStockRefresh','msStockStatus','msStockCount','msStockRows',
    'msStockSearchForm','msStockSearch','msStockClear','msStockPrev','msStockNext','msStockPage'
  ])assert.equal((fragment.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/src="ms-stock-bystore\.mjs"/);
  assert.match(html,/Остатки по складам/);
  assert.match(html,/Готовая продукция/);
  assert.match(html,/Неизвестно|нет данных/);
  assert.doesNotMatch(fragment,/демо-остатки|остатки 108 м как реальные/i);
});
test('warehouse first page auto-refreshes when visible, private, bounded and not persisted',()=>{
  assert.match(js,/button\.addEventListener\('click'/);
  assert.match(js,/\/api\/ms\/stock-bystore/);
  assert.match(js,/method:'GET'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/document\.visibilityState==='visible'/);
  assert.match(js,/pending/);
  assert.match(js,/const PAGE=10/);
  assert.match(js,/Неизвестно/);
  assert.match(js,/ms-stock-negative/);
  assert.match(js,/const AUTO_REFRESH_MS=30\*60\*1000/);
  assert.match(js,/window\.setInterval\(refreshIfNeeded,60\*1000\)/);
  assert.match(js,/state\.offset===0&&state\.search===null/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|method:'POST'/);
});
test('production numbers are sourced from existing real feed and page audit only',()=>{
  assert.match(prod,/executiveTasks\.textContent=.*payload\.totalAllTime/);
  assert.match(prod,/executiveAudit\.textContent=summary\.checked/);
  assert.match(html,/Исторические и текущие; это не число активных заказов/);
  assert.match(css,/\.ms-executive-overview/);
  assert.match(css,/\.ms-stock-table/);
  assert.match(css,/@media\(max-width:720px\)/);
});

test('warehouse dropdown is derived from visible API page and does not request network on change',()=>{
  assert.equal((html.match(/id="msStockWarehouse"/g)||[]).length,1);
  assert.equal((html.match(/id="msStockScopeNote"/g)||[]).length,1);
  assert.match(html,/Фильтр применяется только к загруженным позициям/);
  assert.match(js,/pageWarehouseNames\(payload\.items\)/);
  assert.match(js,/selectStockPageGroups\(lastPayload\.items,warehouse\.value\)/);
  assert.match(js,/warehouse\.addEventListener\('change',\(\)=>\{if\(lastPayload&&!pending\)renderPage\(\);\}\)/);
  assert.match(js,/name\.rowSpan=stores\.length/);
  assert.match(js,/unit\.rowSpan=stores\.length/);
  assert.match(js,/Не указана/);
  assert.match(js,/На этой странице у выбранного склада нет строк/);
  assert.match(css,/\.ms-stock-product-name/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|method:'POST'/);
});
