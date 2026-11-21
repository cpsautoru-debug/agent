import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {
  createProductionAutoStatusHandler,validateAutoStatusScope,
  normalizeAutoRuntime,summarizeAutoStatus
}=await import('../../functions/api/ms/production-auto-status.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const URL_BASE='https://autosklad63-office-staging.pages.dev/api/ms/production-auto-status';
const NOW=1_900_000_000_000;
const UUID='00000000-0000-4000-8000-000000000001';
const state={
  generation:2,next_offset:15,total_first_seen:15,run_status:'pass_complete',
  last_success_ms:NOW-60_000,last_error_code:''
};
const tally={checked:15,incomplete:2,complete:12,unverified:1};
const item={
  task_id:UUID,number:'00740',task_stage_status:'incomplete',
  remaining_qty:2,planned_qty:5,first_unfinished_stage:'Пошив',
  plan_date:'2026-11-19 10:00:00.000',checked_ms:NOW-60_000
};
const envBase={
  OFFICE_SESSION_SECRET:'synthetic-session-secret',
  OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
  OZON_FINANCE_DB:{prepare(sql){
    assert.match(sql,/office_authorized_users/);
    return {bind(sub,email){
      assert.equal(email,'owner@example.invalid');
      return {async first(){return sub==='owner-id'?{allowed:1}:null;}};
    }};
  }}
};
const db=(runtime=state,counts=tally,rows=[item])=>{
  const calls=[];
  return {calls,prepare(sql){
    assert.match(sql,/^SELECT /);
    assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|DROP/i);
    calls.push(sql);
    if(sql.includes('FROM ms_production_auto_runtime'))
      return {async first(){return runtime;}};
    if(sql.includes('COUNT(*)'))
      return {bind(id){assert.equal(id,runtime.generation);return{
        async first(){return counts;}
      };}};
    if(sql.includes('FROM ms_production_auto_tasks'))
      return {bind(id){assert.equal(id,runtime.generation);return{
        async all(){return {results:rows};}
      };}};
    throw Error('unexpected_sql');
  }};
};
const req=async(sub='owner-id',url=URL_BASE)=>{
  const headers={};
  if(sub)headers.Cookie=(await createSession(sub,envBase.OFFICE_SESSION_SECRET)).split(';')[0];
  return new Request(url,{headers});
};

test('only owner can access a read-only, parameter-free status endpoint',async()=>{
  const storage=db();
  const env={...envBase,MS_PRODUCTION_DB:storage};
  const handler=createProductionAutoStatusHandler({now:()=>NOW});
  for(const [sub,url,status] of [
    [null,URL_BASE,401],['other-sub',URL_BASE,403],
    ['owner-id',URL_BASE+'?generation=1',400],
    ['owner-id',URL_BASE+'?secret=x',400],
    ['owner-id','https://evil.invalid/api/ms/production-auto-status',400]
  ]){
    const r=await handler({request:await req(sub,url),env});
    assert.equal(r.status,status);
  }
  const r=await handler({request:new Request(URL_BASE,{method:'POST'}),env});
  assert.equal(r.status,405);
  assert.equal(storage.calls.length,0);
  assert.throws(()=>validateAutoStatusScope(new URL(URL_BASE+'?limit=9999')));
});
test('missing production binding is an explicit unavailable status, no fake zero tasks',async()=>{
  const handler=createProductionAutoStatusHandler({now:()=>NOW});
  const r=await handler({request:await req(),env:envBase});
  assert.equal(r.status,503);
  const payload=await r.json();
  assert.equal(payload.code,'ms_auto_storage_not_configured');
  assert.equal(Object.hasOwn(payload,'totals'),false);
  assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('completed historical pass uses same D1 generation and shows incomplete rows without claiming active orders',async()=>{
  const storage=db();
  const handler=createProductionAutoStatusHandler({now:()=>NOW});
  const result=await handler({request:await req(),env:{...envBase,MS_PRODUCTION_DB:storage}});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.code,'ms_production_auto_status_ok');
  assert.equal(body.source,'DEDICATED_MS_PRODUCTION_D1_CURSOR');
  assert.equal(body.scope,'COMPLETED_NONATOMIC_HISTORICAL_PASS_NOT_LIVE_ACTIVE_QUEUE');
  assert.equal(body.completeHistoricalPass,true);
  assert.equal(body.approvedForLiveQueue,false);
  assert.equal(body.scanState,'pass_complete');
  assert.equal(body.freshness,'recent');
  assert.equal(body.monitorHealth,'on_schedule');
  assert.equal(body.expectedIntervalMinutes,5);
  assert.equal(body.totals.checked,15);
  assert.equal(body.totals.incomplete,2);
  assert.equal(body.shown,1);
  assert.equal(body.remainingRowsNotShown,1);
  assert.equal(body.items[0].number,'00740');
  assert.equal(body.items[0].status,'incomplete');
  assert.equal(body.items[0].remaining,2);
  assert.equal(body.items[0].firstUnfinishedStage,'Пошив');
  assert.equal(body.items[0].plannedDateControl,'past');
  assert.deepEqual(body.visibleDateChecks,
    {past:1,today:0,future:0,notSet:0,unverified:0});
  assert.equal(body.changedRecords,0);
  assert.equal(storage.calls.length,3);
  assert.doesNotMatch(JSON.stringify(body),/00000000-0000-4000-8000|synthetic-session-secret/);
});
test('partial history cannot imply coverage or claim completion, even when runtime reports complete',()=>{
  const result=summarizeAutoStatus(
    normalizeAutoRuntime(state,NOW),
    {checked:14,incomplete:2,complete:11,unverified:1},
    [item],NOW
  );
  assert.equal(result.completeHistoricalPass,false);
  assert.equal(result.scope,'PARTIAL_HISTORICAL_SCAN_NOT_LIVE_ACTIVE_QUEUE');
  const unfinished=summarizeAutoStatus(
    normalizeAutoRuntime({...state,run_status:'scanning'},NOW),
    tally,[item],NOW);
  assert.equal(unfinished.completeHistoricalPass,false);
});
test('stale or never-run background scan is explicitly not recent',()=>{
  assert.equal(normalizeAutoRuntime({...state,last_success_ms:0},NOW).freshness,'never');
  assert.equal(normalizeAutoRuntime({...state,last_success_ms:NOW-2*24*60*60*1000},NOW).freshness,'stale');
  assert.equal(normalizeAutoRuntime({...state,run_status:'paused',last_error_code:'ms_rate_limited'},NOW).scanState,'paused');
});
test('any malformed counts, duplicate task rows or unsupported quantities fail closed',async()=>{
  const invalid=[
    [{checked:5,incomplete:3,complete:3,unverified:0},[item]],
    [tally,[item,item]],
    [tally,[{...item,number:'=HYPERLINK("evil")'}]],
    [tally,[{...item,remaining_qty:-3}]]
  ];
  const handler=createProductionAutoStatusHandler({now:()=>NOW});
  for(const [count,rows] of invalid){
    const r=await handler({request:await req(),env:{
      ...envBase,MS_PRODUCTION_DB:db(state,count,rows)
    }});
    assert.equal(r.status,503);
    const body=await r.json();
    assert.equal(body.code,'ms_auto_status_unavailable');
    assert.equal(Object.hasOwn(body,'items'),false);
  }
});

test('5-minute monitor detects stalls long before 24-hour stale-history threshold',()=>{
  const ready=normalizeAutoRuntime({...state,run_status:'scanning',last_success_ms:NOW-19*60_000},NOW);
  const ok=summarizeAutoStatus(ready,tally,[item],NOW);
  assert.equal(ok.monitorHealth,'on_schedule');
  assert.equal(ok.freshness,'recent');
  const slow=normalizeAutoRuntime({...state,run_status:'scanning',last_success_ms:NOW-21*60_000},NOW);
  const stalled=summarizeAutoStatus(slow,tally,[item],NOW);
  assert.equal(stalled.monitorHealth,'delayed');
  assert.equal(stalled.freshness,'recent');
  assert.equal(stalled.approvedForLiveQueue,false);
  const paused=summarizeAutoStatus(normalizeAutoRuntime(
    {...state,run_status:'paused',last_error_code:'ms_rate_limited'},NOW),tally,[item],NOW);
  assert.equal(paused.monitorHealth,'stopped');
  const initial=summarizeAutoStatus(normalizeAutoRuntime(
    {...state,run_status:'new',last_success_ms:0},NOW),tally,[item],NOW);
  assert.equal(initial.monitorHealth,'not_started');
  const clockSkew=summarizeAutoStatus(normalizeAutoRuntime(
    {...state,run_status:'scanning',last_success_ms:NOW+60_000},NOW),tally,[item],NOW);
  assert.equal(clockSkew.monitorHealth,'delayed');
});

test('date risk indicators are only scoped to shown verified incomplete rows',()=>{
  const today=new Date(NOW+4*60*60*1000).toISOString().slice(0,10);
  const tomorrow=new Date(NOW+28*60*60*1000).toISOString().slice(0,10);
  const rows=[
    item,
    {...item,task_id:'00000000-0000-4000-8000-000000000002',
      number:'00741',plan_date:today+' 12:00:00.000'},
    {...item,task_id:'00000000-0000-4000-8000-000000000003',
      number:'00742',plan_date:tomorrow+' 12:00:00.000'},
    {...item,task_id:'00000000-0000-4000-8000-000000000004',
      number:'00743',plan_date:null},
    {...item,task_id:'00000000-0000-4000-8000-000000000005',
      number:'00744',plan_date:'2026-02-31 10:00:00.000'}
  ];
  const result=summarizeAutoStatus(normalizeAutoRuntime(state,NOW),
    {checked:12,incomplete:8,complete:3,unverified:1},rows,NOW);
  assert.deepEqual(result.visibleDateChecks,
    {past:1,today:1,future:1,notSet:1,unverified:1});
  assert.deepEqual(result.items.map(x=>x.plannedDateControl),
    ['past','today','future','not_set','unverified']);
  assert.equal(result.shown,5);
  assert.equal(result.remainingRowsNotShown,3);
  assert.equal(result.approvedForLiveQueue,false);
  const tampered=[{...item,checked_ms:NOW+60_000}];
  assert.throws(()=>summarizeAutoStatus(normalizeAutoRuntime(state,NOW),
    tally,tampered,NOW),/auto_rows_unverified/);
});
