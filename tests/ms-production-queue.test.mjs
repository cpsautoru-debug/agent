import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleQueue} from '../functions/api/ms/production-queue.js';

const clock=Date.parse('2026-11-23T08:30:00Z');
const runtime={
  generation:6,next_offset:700,total_first_seen:744,
  run_status:'scanning',last_success_ms:clock-300000
};
const row=(number='00740',overrides={})=>({
  generation:6,
  task_id:'00000000-0000-4000-8000-000000000001',
  number,task_stage_status:'incomplete',remaining_qty:2,
  planned_qty:3,first_unfinished_stage:'Раскрой',
  plan_date:null,checked_ms:clock-300000,...overrides
});
test('candidate queue requires confirmed previous full historical pass',()=>{
  const ok=assembleQueue(runtime,744,700,{incomplete:1,unverified:0},[row()],clock);
  assert.equal(ok.code,'ms_production_queue_candidates_ok');
  assert.equal(ok.approvedForDispatch,false);
  assert.equal(ok.items[0].liveVerified,false);
  assert.equal(ok.items[0].orderStatusVerified,false);
  assert.equal(ok.inProgress,true);
  const noBaseline=assembleQueue(runtime,743,700,{incomplete:1,unverified:0},[row()],clock);
  assert.equal(noBaseline.code,'ms_production_queue_baseline_missing');
});
test('a complete pass does not require an earlier generation',()=>{
  const complete={...runtime,run_status:'pass_complete',next_offset:744};
  const result=assembleQueue(complete,0,744,{incomplete:1,unverified:0},[row()],clock);
  assert.equal(result.code,'ms_production_queue_candidates_ok');
  assert.equal(result.baselineGeneration,6);
  assert.equal(result.inProgress,false);
});
test('cursor must match committed rows',()=>{
  assert.throws(
    ()=>assembleQueue(runtime,744,699,{incomplete:1,unverified:0},[row()],clock),
    /ms_queue_unverified/
  );
  assert.throws(
    ()=>assembleQueue({...runtime,next_offset:745},744,745,
      {incomplete:1,unverified:0},[row()],clock),
    /ms_queue_unverified/
  );
});
test('duplicate identities and invalid task rows fail closed',()=>{
  assert.throws(
    ()=>assembleQueue(runtime,744,700,{incomplete:2,unverified:0},
      [row(),row('00741')],clock),/ms_queue_duplicate/
  );
  assert.throws(
    ()=>assembleQueue(runtime,744,700,{incomplete:1,unverified:0},
      [row('00740',{task_id:'other'})],clock),/ms_queue_invalid_source_row/
  );
});
test('an unverified stage chain cannot become an active production task',()=>{
  const item=row('00740',{task_stage_status:'unverified',remaining_qty:null});
  const result=assembleQueue(runtime,744,700,{incomplete:0,unverified:1},[item],clock);
  assert.equal(result.items[0].status,'unverified');
  assert.equal(result.items[0].plannedDateControl,'unverified');
  assert.equal(result.approvedForDispatch,false);
});
