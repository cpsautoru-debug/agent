import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-production-coverage-probe.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../../web/office/ms-production.css',import.meta.url),'utf8');

test('probe requires explicit button and uses only scoped owner-only GET route',()=>{
  for(const id of ['msCoverageProbeStart','msCoverageProbeStatus','msCoverageProbeSummary'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  assert.match(html,/src="ms-production-coverage-probe\.mjs"/);
  assert.match(js,/button\.addEventListener\('click'/);
  assert.match(js,/method:'GET'/);
  assert.match(js,/credentials:'same-origin'/);
  assert.match(js,/production-coverage-probe/);
  assert.match(js,/location\.hash/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|setInterval|setTimeout|method:'POST'|innerHTML/);
});
test('browser never asserts coverage from sample-only response',()=>{
  assert.match(js,/allUnfinishedVerified!==false/);
  assert.match(js,/estimateProductionScanWorkload\(body\.totalTaskDocuments,body\.sampleTaskStageCount\)/);
  assert.match(js,/Общее количество этапов неизвестно/);
  assert.match(js,/body\.globalStageListAvailable!==false/);
  assert.match(js,/body\.totalProductionStages!==null/);
  assert.match(js,/body\.stageListScope/);
  assert.match(js,/sampleRowTaskMatch/);
  assert.match(js,/принадлежность позиции выбранному заданию по ссылке не подтверждена/);
  assert.match(js,/позиция принадлежит выбранному заданию/);
  assert.doesNotMatch(js,/count\(body\.totalProductionStages\)/);
  assert.match(js,/пауза не меньше 2 секунд/);
  assert.match(js,/Полнота связей и фактические незавершённые задания не проверены/);
  assert.match(html,/весь цех не выгружается/);
  assert.match(css,/\.ms-coverage-probe/);
});

test('diagnostic errors show only allowlisted entity and numeric HTTP',()=>{
  assert.match(js,/\['productiontask','productionstage'\]\.includes\(body\?\.upstreamEntity\)/);
  assert.match(js,/Number\.isInteger\(body\?\.upstreamHttp\)/);
  assert.match(js,/body\.upstreamHttp>=300&&body\.upstreamHttp<=599/);
  assert.match(js,/status\.textContent='Диагностика не завершена:/);
  assert.doesNotMatch(js,/innerHTML|response\.headers\.get\('Authorization'\)/);
});
