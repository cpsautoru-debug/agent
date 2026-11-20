import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-production-priority.mjs',import.meta.url),'utf8');
const core=readFileSync(new URL('../../web/office/ms-production-priority-core.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');
test('priority production block is in main dashboard before historical task browser',()=>{
  const card=html.indexOf('id="msCommandBoard"');
  const priority=html.indexOf('id="msPriorityWorklist"');
  const historical=html.indexOf('id="msProductionMonitor"');
  assert.ok(card>0&&priority>card&&historical>priority);
  for(const id of [
    'msPriorityWorklist','msPriorityTitle','msPriorityForm','msPriorityNumbers',
    'msPriorityStop','msPriorityExport','msPriorityStatus',
    'msPrioritySummary','msPriorityTable','msPriorityRows'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/Задания в работе · контроль по номерам/);
  assert.match(html,/type="module" src="ms-production-priority\.mjs"/);
  assert.match(css,/\.ms-priority-worklist/);
});
test('priority watchlist is manual, explicitly scoped and does not persist/store task numbers',()=>{
  assert.match(js,/form\.addEventListener\('submit',async event=>/);
  assert.match(js,/parsePriorityNumbers/);
  assert.match(js,/collectPriorityProduction/);
  assert.match(js,/document\.visibilityState==='visible'/);
  assert.match(js,/stop\.addEventListener\('click'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/method:'GET'/);
  assert.match(core,/MAX_PRIORITY_TASKS=5/);
  assert.match(core,/PRIORITY_DELAY_MS=2000/);
  assert.match(html,/до пяти точных|пяти точных|пяти|пять|Не более пяти точных номеров/i);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|fetch\([^)]*method:'POST'/);
});
test('status and local CSV cannot be mistaken for full production queue or authorizing a write',()=>{
  assert.match(html,/не полный список действующих заказов/);
  assert.match(html,/кнопка CSV только сохраняет локальный контрольный список/i);
  assert.match(js,/buildPriorityCsv/);
  assert.match(js,/text\/csv/);
  assert.match(js,/Не подтверждено/);
  assert.match(js,/msProductionSearchForm/);
  assert.match(js,/taskForm\.requestSubmit\(\)/);
  assert.match(js,/summary\.textContent/);
  assert.match(core,/EXACT_USER_SELECTED_TASK_NUMBERS_NOT_ALL_ACTIVE_ORDERS/);
});
