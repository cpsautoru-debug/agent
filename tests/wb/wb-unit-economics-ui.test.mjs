import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/wb-unit-economics.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/wb-unit-economics.css',import.meta.url),'utf8');
const model=readFileSync(new URL('../../web/office/wb-unit-economics-core.mjs',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../migrations/wb/0007_wb_profit_unit_costs.sql',import.meta.url),'utf8');

test('WB section shows real per-SKU article economics and manual cost preview',()=>{
  assert.match(html,/Результат по каждому артикулу WB/);
  for(const id of ['wbUnitEconomics','wbUnitRefresh','wbUnitStatus','wbUnitRows',
    'wbUnitPayout','wbUnitKnownCogs','wbUnitMissingCost','wbUnitNetProfit',
    'wbUnitCostForm','wbUnitCostVendor','wbUnitCostAmount',
    'wbUnitCostFrom','wbUnitCostSource','wbUnitCostPreview',
    'wbUnitCostConfirm','wbUnitCostAttestation','wbUnitCostMessage']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  }
  assert.ok(html.indexOf('id="wbUnitEconomics"')>
    html.indexOf('id="wbAutoSyncPanel"'));
  assert.match(html,/Чистая прибыль предприятия/);
  assert.match(html,/материалы \+ оплату швеи \+ оплату закройщика/);
  assert.match(html,/Упаковщик, водитель, управляющий, ОТК/);
  assert.match(html,/Аренда, коммунальные услуги, мусор/);
  assert.match(html,/wb-unit-economics\.js\?v=20261121/);
  assert.match(html,/wb-unit-economics\.css\?v=20261121/);
  assert.match(css,/\.wb-unit-columns/);
});
test('UI reads owner API only while WB tab visible and never invents revenue or final profit',()=>{
  assert.match(js,/fetch\('\/api\/wb\/unit-economics'/);
  assert.match(js,/method:'GET',credentials:'same-origin',cache:'no-store'/);
  assert.match(js,/location\.hash\.split\('\/'\)\[0\]==='#wbFinance'/);
  assert.match(js,/Date\.now\(\)-lastRead<5\*60\*1000/);
  assert.match(js,/netProfitKopecks!==null/);
  assert.match(js,/Не рассчитана/);
  assert.match(js,/unassignedPayoutKopecks/);
  assert.match(js,/unknownSoldUnits/);
  assert.match(js,/wbUnitCostConfirm/);
  assert.match(js,/action:'preview'/);
  assert.match(js,/action:'confirm'/);
  assert.match(js,/Сохранить подтверждённую запись/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|innerHTML/);
  assert.doesNotMatch(js,/\/api\/wb\/sync-once|finance-api\.wildberries\.ru/);
  assert.match(model,/netProfitKopecks:null/);
});
test('new COGS table is additive, immutable and scoped to one WB account',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS wb_profit_unit_costs/);
  assert.match(migration,/PRIMARY KEY \(account_id,vendor_code,valid_from\)/);
  assert.match(migration,/CREATE TRIGGER IF NOT EXISTS wb_profit_cost_no_update/);
  assert.match(migration,/CREATE TRIGGER IF NOT EXISTS wb_profit_cost_no_delete/);
  assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|UPDATE wb_finance_api_rows/);
});

test('finance failure messages explain safe stages without exposing backend errors',()=>{
  for(const key of ['wb_profit_payout_reconciliation_failed',
    'wb_profit_operation_coverage_invalid',
    'wb_profitability_unavailable_cost_registry_probe',
    'wb_profitability_unavailable_completed_report_aggregation'])
    assert.ok(js.includes(key),key);
  assert.match(js,/Код: /);
  assert.doesNotMatch(js,/error\\?.stack|error\\?.cause/);
});

test('unknown HTTP errors and 200 schema errors have separate safe identifiers',()=>{
  for(const key of ['wb_unit_http_404','wb_unit_http_500','wb_unit_http_503',
    'wb_unit_response_not_json','wb_unit_response_validation_failed',
    'configuration_unavailable','wb_profitability_unavailable_general']){
    assert.ok(js.includes(key),key);
  }
  assert.match(html,/wb-unit-economics\\.js\\?v=20261121-http-diagnostics/);
  assert.match(js,/!response\\.ok/);
  assert.match(js,/try\\{draw\\(payload\\);\\}/);
  assert.doesNotMatch(js,/error\\.stack|error\\.cause|console\\.error/);
});
