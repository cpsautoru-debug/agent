import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-production.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');

test('page audit is opt-in and restricted to current page only',()=>{
  for(const id of [
    'msPageAudit','msPageAuditStart','msPageAuditStatus',
    'msPageAuditStats','msPageAuditResults','msPageAuditRows',
    'msAuditChecked','msAuditIncomplete','msAuditComplete','msAuditUnknown'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/это не общий остаток цеха|Это не общий остаток цеха/);
  assert.match(js,/records\.slice\(0,5\)/);
  assert.match(js,/auditButton\.addEventListener\('click',auditVisiblePage\)/);
  assert.match(js,/isVisible\(\)/);
  assert.match(js,/ms_production_stages_ok/);
  assert.match(js,/summarizePageAudit\(/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|fetch\([^)]*POST/);
});
test('current pagination and stage drilldown are preserved',()=>{
  assert.match(js,/msProductionNext/);
  assert.match(js,/msProductionPrev/);
  assert.match(js,/msProductionSearchForm/);
  assert.match(js,/loadStages/);
  assert.match(css,/\.ms-page-audit/);
});
