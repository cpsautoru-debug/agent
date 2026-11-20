// Pure calculation only: no external requests, writes, or timers.
// MoySklad productionstage requires a productionTask filter. No global stage total.
const PAGE=50;
const MAX_CALLS_PER_BATCH=10;
export function estimateProductionScanWorkload(taskCount,sampleTaskStageCount=null){
  if(!Number.isSafeInteger(taskCount)||taskCount<0||taskCount>10000000||
    (sampleTaskStageCount!==null&&
      (!Number.isSafeInteger(sampleTaskStageCount)||
        sampleTaskStageCount<0||sampleTaskStageCount>10000000)))
    throw Error('invalid_scan_estimate_input');
  const taskPages=Math.max(1,Math.ceil(taskCount/PAGE));
  // Every productionTask must be inspected separately. Stages may need
  // additional pages per task; no global count or fast bulk shortcut is known.
  const perTaskMinimumRequests=taskPages+taskCount;
  return {
    scope:'ESTIMATE_ONLY_NOT_EXECUTED',
    taskPages,pageSize:PAGE,
    sampleTaskStageCount,
    sampleTaskStagePages50:sampleTaskStageCount===null?
      null:Math.ceil(sampleTaskStageCount/PAGE),
    totalStageCount:null,
    globalStageListSupported:false,
    bulkCandidateRequests:null,
    bulkCandidateBatches:null,
    maxCallsPerBatch:MAX_CALLS_PER_BATCH,
    concurrentRequests:1,
    proposedMinGapMs:2000,
    perTaskMinimumRequests,
    perTaskMinimumBatches:Math.ceil(perTaskMinimumRequests/MAX_CALLS_PER_BATCH),
    perTaskIsLowerBound:true,
    // Additional stage pages, retries and end-of-scan validation not included.
    completeCoverageProven:false
  };
}
