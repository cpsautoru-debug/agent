import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateProductionScanWorkload} from '../../web/office/ms-production-scan-budget.mjs';

test('planning 740 historical tasks is a lower bound and never a live scan',()=>{
  const p=estimateProductionScanWorkload(740,3700);
  assert.equal(p.taskPages,15);
  assert.equal(p.stagePages,74);
  assert.equal(p.bulkCandidateRequests,89);
  assert.equal(p.bulkCandidateBatches,9);
  assert.equal(p.perTaskMinimumRequests,755);
  assert.equal(p.perTaskMinimumBatches,76);
  assert.equal(p.scope,'ESTIMATE_ONLY_NOT_EXECUTED');
  assert.equal(p.bulkJoinProven,false);
  assert.equal(p.completeCoverageProven,false);
  assert.equal(p.concurrentRequests,1);
  assert.equal(p.proposedMinGapMs,2000);
  assert.equal(p.perTaskIsLowerBound,true);
});

test('zero count and page boundary estimates are well-defined',()=>{
  const empty=estimateProductionScanWorkload(0,0);
  assert.equal(empty.bulkCandidateRequests,0);
  assert.equal(empty.perTaskMinimumRequests,0);
  assert.equal(estimateProductionScanWorkload(50,51).bulkCandidateRequests,3);
  assert.equal(estimateProductionScanWorkload(51,50).perTaskMinimumRequests,53);
});

test('reject malformed or excessive figures',()=>{
  for(const [tasks,stages] of [[NaN,20],[1.2,20],[-1,50],[1,Infinity],[10000001,0]])
    assert.throws(()=>estimateProductionScanWorkload(tasks,stages),'invalid input');
});
