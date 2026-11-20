import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-production-command-board.mjs',import.meta.url),'utf8');
const core=readFileSync(new URL('../../web/office/ms-production-board-core.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');
const warehouse=readFileSync(new URL('../../web/office/ms-warehouse-snapshot.mjs',import.meta.url),'utf8');

test('owner production console is visible before page-by-page diagnostic screens',()=>{
  const start=html.indexOf('id="msCommandBoard"');
  const list=html.indexOf('id="msProductionMonitor"');
  const stock=html.indexOf('id="msStockSection"');
  assert.ok(start>0&&list>start&&stock>list);
  for(const id of [
    'msBoardRun','msBoardStop','msBoardStatus','msBoardStats',
    'msBoardChecked','msBoardIncomplete','msBoardComplete',
    'msBoardUnknown','msBoardPast','msBoardTime',
    'msBoardResults','msBoardRows','msBoardStageSummary','msBoardWarehouse',
    'msBoardGoWarehouse','msBoardGoTasks'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/type="module" src="ms-production-command-board\.mjs"/);
  assert.match(css,/\.ms-command-board/);
  assert.match(css,/\.ms-board-metrics/);
});
test('production manager sees explicit scope and no fabricated full active queue',()=>{
  assert.match(html,/проверить этапы последних 10/);
  assert.match(html,/не вся незавершёнка/);
  assert.match(html,/До 12 последовательных GET с паузой/);
  assert.match(js,/LATEST_10_DOCUMENTS_NOT_ALL_ACTIVE_ORDERS|последних по дате документов/);
  assert.match(js,/Это НЕ полный перечень активных заказов/);
  assert.match(js,/firstUnfinishedStage/);
  assert.match(js,/className='ms-plan-date-past'/);
  assert.match(js,/Ещё не завершено|Не завершено/);
  assert.match(core,/assessProductionTask/);
  assert.match(core,/classifyProductionPlanDate/);
});
test('only user click starts bounded scan; stopping or hiding tab cancels next requests',()=>{
  assert.match(js,/run\.addEventListener\('click',async\(\)=>/);
  assert.match(js,/stop\.addEventListener\('click'/);
  assert.match(js,/const active=\(\)=>!stopped&&document\.visibilityState==='visible'/);
  assert.match(js,/collectRecentProduction/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/method:'GET'/);
  assert.match(core,/requests>=12/);
  assert.match(core,/REQUEST_DELAY_MS=2000/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|setInterval|setTimeout\([^)]*,\s*60000/);
});
test('warehouse dashboard emits only ephemeral counts to production console',()=>{
  assert.match(warehouse,/new CustomEvent\('ms:warehouse-snapshot-ready'/);
  assert.match(js,/window\.addEventListener\('ms:warehouse-snapshot-ready'/);
  assert.match(warehouse,/positions:snapshot\.itemCount/);
  assert.match(warehouse,/missingUnits:snapshot\.items\.filter/);
  assert.doesNotMatch(warehouse,/localStorage|sessionStorage|indexedDB|fetch\('\/api\/ms\/production-board/);
});
test('the board opens exact task by number in existing production UI',()=>{
  assert.match(js,/form\.requestSubmit\(\)/);
  assert.match(js,/msProductionSearchForm/);
  assert.match(js,/msProductionNumber/);
  assert.match(html,/id="msProductionSearchForm"/);
});
