import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-production-auto-status.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');

test('automatic history is shown beside production manager, not a disguised live queue',()=>{
  for(const id of [
    'msAutoHistory','msAutoHistoryTitle','msAutoHistoryStatus',
    'msAutoHistoryDetails','msAutoHistoryAttention','msAutoHistoryTable','msAutoHistoryRows',
    'msAutoUnknown','msAutoUnknownSummary','msAutoUnknownRows',
    'msAutoHistoryRetry'
  ])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  const cmd=html.indexOf('id="msCommandBoard"');
  const auto=html.indexOf('id="msAutoHistory"');
  const manual=html.indexOf('id="msPriorityWorklist"');
  assert.ok(cmd>=0&&auto>cmd&&manual>auto);
  assert.match(html,/не единый снимок активных заказов/);
  assert.match(html,/до подтверждения статуса заказа/i);
  assert.match(html,/src="ms-production-auto-status\.mjs"/);
  assert.match(css,/\.ms-auto-history/);
});
test('auto history reads protected endpoint only, without user input or writes',()=>{
  assert.match(js,/\/api\/ms\/production-auto-status/);
  assert.match(js,/method:'GET'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/cache:'no-store'/);
  assert.match(js,/document\.visibilityState==='visible'/);
  assert.match(js,/window\.setInterval\(maybeLoad,60\*1000\)/);
  assert.match(js,/EVERY_MS=5\*60\*1000/);
  assert.match(js,/location\.hash\.split\('\/'\)\[0\]==='#production'/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|innerHTML|POST|DELETE|PATCH|PUT/);
});
test('UI rejects fake live-queue status and missing storage never claims zero tasks',()=>{
  assert.match(js,/data\.approvedForLiveQueue!==false/);
  assert.match(js,/data\.completeHistoricalPass/);
  assert.match(js,/ms_auto_storage_not_configured/);
  assert.match(js,/Автоматическая проверка последних обновлённых заданий выше продолжает работать/);
  assert.match(js,/Без подтверждения активного статуса/);
  assert.match(js,/Никаких статусов не предполагаем/);
  assert.match(js,/Не считаем их нулевыми или завершёнными/);
});

test('UI prominently warns about stalled and stopped background synchronization',()=>{
  assert.match(js,/data\.monitorHealth/);
  assert.match(js,/data\.expectedIntervalMinutes!==5/);
  assert.match(js,/нет успешной синхронизации более 20 минут/);
  assert.match(js,/фоновая синхронизация остановлена/);
  assert.match(js,/approvedForLiveQueue!==false/);
});

test('verified historical incomplete rows show risk date in Samara without claiming live backlog',()=>{
  assert.match(html,/Контроль срока/);
  assert.match(html,/id="msAutoHistoryAttention"/);
  assert.match(js,/data\.visibleDateChecks/);
  assert.match(js,/plannedDateControl/);
  assert.match(js,/Плановая дата прошла/);
  assert.match(js,/показанной исторической выборке/);
  assert.match(js,/const ordered=\[\.\.\.data\.items\]\.sort/);
  assert.match(css,/\.ms-auto-history \.ms-auto-overdue td/);
  assert.doesNotMatch(js,/fetch\([^]*?method:'POST'/);
});

test('unverified historical documents are visible without assigning production status',()=>{
  assert.match(html,/Задания с неподтверждёнными этапами/);
  assert.match(js,/data\.unverifiedItems/);
  assert.match(js,/data\.unverifiedShown/);
  assert.match(js,/data\.unverifiedNotShown/);
  assert.match(js,/Этапы не подтверждены/);
  assert.match(js,/Эти документы нельзя считать ни завершёнными, ни незавершёнными/);
  assert.match(js,/unknownBody\.replaceChildren\(\)/);
  assert.match(js,/unknown\.hidden=data\.unverifiedItems\.length===0/);
  assert.match(css,/\.ms-auto-unknown\[hidden\]/);
});
