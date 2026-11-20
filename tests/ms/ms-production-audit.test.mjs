import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProductionTask,summarizePageAudit} from '../../web/office/ms-production-audit.mjs';

const doc={number:'00737'};
const stages=(plan,done,stageCounts)=>({
  code:'ms_production_stages_ok',plan,finishedFinalStage:done,
  stages:stageCounts.map(([name,expected,actual],order)=>({
    name,order,plan:expected,done:actual
  }))
});

test('incomplete job: identifies first unfinished stage, not every unfinished stage as separate task',()=>{
  const task=assessProductionTask(doc,stages(4,1,[
    ['Раскрой материала',4,4],['Пошив',4,2],
    ['Контроль качества',4,1],['Упаковка',4,1],
    ['Готово к отгрузке',4,1]
  ]));
  assert.deepEqual(task,{
    number:'00737',status:'incomplete',plan:4,finished:1,remaining:3,
    firstUnfinishedStage:'Пошив'
  });
});

test('completely finished job is not mistakenly counted as unfinished',()=>{
  const r=assessProductionTask({number:'00735'},stages(4,4,[
    ['Раскрой',4,4],['Пошив',4,4],
    ['ОТК',4,4],['Упаковка',4,4],
    ['Готово к отгрузке',4,4]
  ]));
  assert.equal(r.status,'complete');
  assert.equal(r.remaining,0);
  assert.equal(r.firstUnfinishedStage,null);
});

test('empty and malformed stage records are not silently treated as zero or done',()=>{
  const v=[
    {code:'ms_production_stages_ok',plan:0,finishedFinalStage:0,stages:[]},
    {code:'ms_production_stages_ok',plan:3,finishedFinalStage:0,stages:[]},
    {code:'ms_production_stages_ok',plan:3,finishedFinalStage:4,stages:[{order:0,name:'Раскрой',plan:3,done:3}]},
    {code:'ms_stages_unverified',plan:3,finishedFinalStage:0,stages:[{order:0,name:'Раскрой',plan:3,done:0}]},
    null
  ];
  for(const payload of v)
    assert.equal(assessProductionTask(doc,payload).status,'unverified');
});
test('inconsistent stage flow remains unverified rather than reporting false completion',()=>{
  const result=assessProductionTask(doc,stages(4,4,[['Раскрой',4,1],['Пошив',4,4]]));
  assert.equal(result.status,'unverified');
  assert.equal(result.code,'stage_chain_not_verified');
  const inconsistent=assessProductionTask(doc,stages(4,0,[['Раскрой',4,1],['Пошив',4,3],['ОТК',4,0]]));
  assert.equal(inconsistent.status,'unverified');
  const omittedStage=assessProductionTask(doc,stages(4,0,[['Раскрой',4,4],['Пошив',2,1],['ОТК',4,0]]));
  assert.equal(omittedStage.status,'unverified');
});
test('bounded page summary counts only checked documents and reports remaining as unverified',()=>{
  const records=[
    assessProductionTask({number:'00737'},stages(3,0,[['Раскрой',3,0],['Пошив',3,0]])),
    assessProductionTask({number:'00735'},stages(4,4,[['Раскрой',4,4],['Пошив',4,4]])),
    {number:'00734',status:'unverified',code:'ms_stages_timeout'}
  ];
  const stats=summarizePageAudit(5,records);
  assert.equal(stats.checked,3);
  assert.equal(stats.incomplete,1);
  assert.equal(stats.complete,1);
  assert.equal(stats.unverified,1);
  assert.equal(stats.notChecked,2);
  assert.deepEqual(stats.firstUnfinishedStages,[{name:'Раскрой',tasks:1}]);
  assert.equal(stats.scope,'ONLY_SELECTED_PAGE_NOT_ALL_UNFINISHED_PRODUCTION');
  assert.throws(()=>summarizePageAudit(6,[]));
  assert.throws(()=>summarizePageAudit(2,records));
});
