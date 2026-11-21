import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-inventory-control.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');
const stock=readFileSync(new URL('../../functions/api/ms/stock-bystore.js',import.meta.url),'utf8');
test('production office includes full warehouse overview, 40m and models before historical monitor',()=>{
  const ids=['msInventoryControl','msInventoryTitle','msInventoryReload',
    'msInventoryPause','msInventoryContinue','msInventoryStatus',
    'msInventoryCoverage','msInventoryStore','msInventoryCategory',
    'msInventorySearch','msInventoryTable','msInventoryRows',
    'msInventoryMoreRows','msInventoryCutSummary','msInventoryCutTable',
    'msInventoryCutRows','msInventoryFinishedSummary','msInventoryFinishedTable',
    'msInventoryFinishedRows','msInventoryCoversSummary','msInventoryCoversTable',
    'msInventoryCoversRows','msInventoryDoorCardsSummary','msInventoryDoorCardsTable',
    'msInventoryDoorCardsRows','msInventoryLoaded','msInventoryLow',
    'msInventoryCut','msInventoryFinished','msInventoryCovers','msInventoryDoorCards',
    'msInventoryUnverified','msInventoryStores'];
  for(const id of ids)assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.ok(html.indexOf('id="msInventoryControl"')<html.indexOf('id="msCommandBoard"'));
  assert.match(html,/script type="module" src="ms-inventory-control\.mjs"/);
  assert.match(html,/строго меньше 40 м на каждом складе/);
  assert.match(html,/учётные остатки, не физическая инвентаризация/);
  assert.match(html,/Крой по моделям/);
  assert.match(html,/Готовая продукция по моделям/);
});
test('automatic inventory overview calls owner-only existing API with bounded pages and no writes',()=>{
  assert.match(js,/fetch\('\/api\/ms\/stock-bystore'/);
  assert.match(js,/method:'GET',credentials:'same-origin',cache:'no-store'/);
  assert.match(js,/checkInventoryPage\(data,offset\)/);
  assert.match(js,/MAX_PAGES=60/);
  assert.match(js,/WAIT_MS=2800/);
  assert.match(js,/offset<=4990/);
  assert.match(js,/!isVisible\(\)/);
  assert.match(js,/document\.visibilityState==='visible'/);
  assert.match(js,/location\.hash\.split\('\/'\)\[0\]==='#production'/);
  assert.match(js,/assortment_total_changed_restart_required/);
  assert.match(js,/Обход не завершён/);
  assert.match(js,/report_page_limit_reached/);
  assert.match(js,/Date\.now\(\)-lastStarted>REFRESH_MS/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML/);
  assert.doesNotMatch(js,/method:'(POST|PUT|DELETE|PATCH)'/);
});
test('unit is explicitly loaded from MoySklad, and alert is warehouse-specific',()=>{
  assert.match(stock,/uom:safeText\(row\.uom\?\.name,50\)/);
  assert.match(html,/Порог срабатывания/);
  assert.match(js,/row\.low\?'МЕНЬШЕ 40 М'/);
  assert.match(css,/\.ms-inventory-low td/);
  assert.match(css,/\.ms-inventory-negative td/);
  assert.match(html,/Категории «крой» и «готовое»/);
});

test('only production-oriented categories are visible; broad stock is retired',()=>{
  assert.match(html,/Только производство/);
  assert.match(html,/Материалы для авточехлов/);
  assert.match(html,/Дверные карты и вставки/);
  assert.match(html,/Авточехлы по моделям/);
  assert.match(html,/Дверные карты и вставки по моделям/);
  assert.match(html,/id="msStockSection"[^>]*hidden aria-hidden="true"/);
  assert.match(css,/\.ms-stock-section\[hidden\]\{display:none!important\}/);
  const old=readFileSync(new URL('../../web/office/ms-stock-bystore.mjs',import.meta.url),'utf8');
  assert.match(old,/if\(section\.hidden\)return/);
  assert.match(js,/summary\?\.productionItems/);
  assert.match(js,/summary\?\.categories\.covers/);
  assert.match(js,/summary\?\.categories\.doorCards/);
  assert.match(js,/renderModelGroup\('doorCards'/);
  assert.match(js,/renderModelGroup\('covers'/);
  assert.match(js,/ms:production-inventory-ready/);
});
