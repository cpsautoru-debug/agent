// Estimate lower-bound scan workload; NO API calls, no scheduling, no writes.
// A bulk stage read is only a candidate until real task/row joins are verified.
const PAGE=50;
const MAX_CALLS_PER_BATCH=10;
export function estimateProductionScanWorkload(taskCount,stageCount){
  for(const n of [taskCount,stageCount])
    if(!Number.isSafeInteger(n)||n<0||n>10000000)
      throw Error('invalid_scan_estimate_input');
  const taskPages=Math.ceil(taskCount/PAGE);
  const stagePages=Math.ceil(stageCount/PAGE);
  const bulkCandidateRequests=taskPages+stagePages;
  const perTaskMinimumRequests=taskPages+taskCount;
  return {
    scope:'ESTIMATE_ONLY_NOT_EXECUTED',
    taskPages,stagePages,
    pageSize:PAGE,
    maxCallsPerBatch:MAX_CALLS_PER_BATCH,
    concurrentRequests:1,
    proposedMinGapMs:2000,
    bulkCandidateRequests,
    bulkCandidateBatches:Math.ceil(bulkCandidateRequests/MAX_CALLS_PER_BATCH),
    bulkJoinProven:false,
    perTaskMinimumRequests,
    perTaskMinimumBatches:Math.ceil(perTaskMinimumRequests/MAX_CALLS_PER_BATCH),
    perTaskIsLowerBound:true,
    // Two passes / validation / slow or failed requests are not included.
    completeCoverageProven:false
  };
}
