import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateProductionScanWorkload} from '../../web/office/ms-production-scan-budget.mjs';

test('one productionTask filter per document yields lower bound only',()=>{
  const p=estimateProductionScanWorkload(740,7);
  assert.equal(p.taskPages,15);
  assert.equal(p.sampleTaskStageCount,7);
  assert.equal(p.sampleTaskStagePages50,1);
  assert.equal(p.perTaskMinimumRequests,755);
  assert.equal(p.perTaskMinimumBatches,76);
  assert.equal(p.bulkCandidateRequests,null);
  assert.equal(p.globalStageListSupported,false);
  assert.equal(p.totalStageCount,null);
  assert.equal(p.completeCoverageProven,false);
  assert.equal(p.concurrentRequests,1);
  assert.equal(p.proposedMinGapMs,2000);
  assert.equal(p.perTaskIsLowerBound,true);
  assert.equal(p.scope,'ESTIMATE_ONLY_NOT_EXECUTED');
});
test('zero and page boundaries never claim a global stage list',()=>{
  const empty=estimateProductionScanWorkload(0,null);
  assert.equal(empty.taskPages,1);
  assert.equal(empty.perTaskMinimumRequests,1);
  assert.equal(empty.sampleTaskStageCount,null);
  assert.equal(estimateProductionScanWorkload(50,51).perTaskMinimumRequests,51);
  assert.equal(estimateProductionScanWorkload(51,50).perTaskMinimumRequests,53);
  assert.equal(estimateProductionScanWorkload(2,137).sampleTaskStagePages50,3);
  assert.equal(estimateProductionScanWorkload(2,137).perTaskMinimumRequests,3);
  assert.equal(estimateProductionScanWorkload(2,137).completeCoverageProven,false);
});
test('reject invalid counts and stage sample sizes',()=>{
  for(const [tasks,stages] of [
    [NaN,20],[1.2,20],[-1,50],[1,Infinity],[10000001,0],[1,-1],[1,1.5]
  ])assert.throws(()=>estimateProductionScanWorkload(tasks,stages),'invalid input');
});
