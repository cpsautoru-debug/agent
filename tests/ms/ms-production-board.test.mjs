import test from 'node:test';
import assert from 'node:assert/strict';
import {collectRecentProduction,checkProductionFeed,summarizeRecentProduction,MAX_TASKS,
  REQUEST_DELAY_MS} from '../../web/office/ms-production-board-core.mjs';
const id=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const NOW=Date.parse('2026-11-20T10:00:00Z');
const tasks=Array.from({length:10},(_,i)=>({
  id:id(i),number:String(i+700).padStart(5,'0'),
  date:'2026-11-20 12:00:00.000',updated:'2026-11-20 12:30:00.000',
  plannedDate:i%2===0?'2026-11-19 10:00:00.000':null,
  documentPosted:true
}));
const feed=(offset,total=744,items=tasks.slice(offset,offset+5))=>({
  code:'ms_production_feed_ok',
  source:'MOYSKLAD_JSON_API',readOnly:true,changedRecords:0,requests:1,
  selection:'LATEST_5_BY_DOCUMENT_DATE_NOT_ACTIVE_TASKS',
  pageSize:5,offset,searchNumber:null,totalAllTime:total,
  records:items,hasMore:offset+items.length<total
});
const response=(status,body)=>({status,body});
const stage=(finished,complete)=>({
  code:'ms_production_stages_ok',plan:3,finishedFinalStage:finished,
  rowChainsVerified:true,rowChainStatus:complete?'complete':'incomplete',
  firstUnfinishedRowStage:complete?null:'Раскрой материала',
  stages:[{name:'Раскрой материала',order:0,plan:3,done:finished}]
});
function stub(paths,{statusByTask={},items=tasks,total=744}={}){
  return async path=>{
    paths.push(path);
    if(path==='/api/ms/production-feed')return response(200,feed(0,total,items.slice(0,5)));
    if(path==='/api/ms/production-feed?offset=5')
      return response(200,feed(5,total,items.slice(5,10)));
    const u=new URL('https://office.invalid'+path);
    if(u.pathname==='/api/ms/production-stages'){
      const num=Number.parseInt(u.searchParams.get('taskId').slice(-12),16);
      if(Object.hasOwn(statusByTask,num))return statusByTask[num];
      const complete=num%2===1;
      return response(200,stage(complete?3:1,complete));
    }
    throw Error('unexpected_url');
  };
}
test('one click checks last ten documents in twelve sequential GETs with bounded pauses',async()=>{
  const paths=[],delays=[],progress=[];
  const result=await collectRecentProduction({
    request:stub(paths),
    pause:async n=>delays.push(n),
    active:()=>true,
    onProgress:p=>progress.push(p),
    nowMs:NOW
  });
  assert.equal(result.code,'ms_production_board_ok');
  assert.equal(result.scope,'LATEST_10_DOCUMENTS_NOT_ALL_ACTIVE_ORDERS');
  assert.equal(result.requests,12);
  assert.equal(result.totalAllTime,744);
  assert.equal(result.items.length,10);
  assert.deepEqual(paths.slice(0,2),[
    '/api/ms/production-feed','/api/ms/production-feed?offset=5'
  ]);
  assert.equal(paths.filter(p=>p.includes('production-stages')).length,10);
  assert.equal(delays.length,11);
  assert.ok(delays.every(x=>x===2000));
  assert.equal(progress.length,10);
  assert.deepEqual(result.summary,{
    checked:10,incomplete:5,complete:5,unverified:0,
    planDatePast:5,planDateToday:0,
    firstIncompleteStages:[{name:'Раскрой материала',tasks:5}],
    scope:'LATEST_10_DOCUMENTS_NOT_ALL_ACTIVE_ORDERS'
  });
  assert.equal(result.items[0].remaining,2);
  assert.equal(result.items[0].planDateStatus,'past');
  assert.equal(result.items[1].planDateStatus,'not_applicable');
  assert.equal(result.changedRecords,0);
  assert.doesNotMatch(JSON.stringify(result),/Bearer|token|access-token/);
});
test('when fewer tasks exist, do not invent missing current orders',async()=>{
  const p=[];
  const result=await collectRecentProduction({
    request:stub(p,{items:tasks.slice(0,3),total:3}),
    nowMs:NOW
  });
  assert.equal(result.code,'ms_production_board_ok');
  assert.equal(result.items.length,3);
  assert.equal(result.requests,4);
  assert.equal(p.some(x=>x.includes('offset=5')),false);
  assert.equal(result.summary.checked,3);
});
test('stage data mismatch and per-document errors remain unverified, never zero',async()=>{
  const paths=[];
  const result=await collectRecentProduction({
    request:stub(paths,{statusByTask:{
      0:response(200,{code:'ms_production_stages_ok',plan:3,finishedFinalStage:3,
        rowChainsVerified:false,rowChainStatus:'unverified',
        stages:[{name:'Раскрой',order:0,plan:3,done:3}]}),
      1:response(502,{code:'ms_stages_unverified'})
    }}),
    nowMs:NOW
  });
  assert.equal(result.code,'ms_production_board_ok');
  assert.equal(result.items[0].status,'unverified');
  assert.equal(result.items[1].status,'unverified');
  assert.equal(result.items[0].planDateStatus,'unverified');
  assert.equal(result.items[0].remaining,undefined);
  assert.equal(result.summary.unverified,2);
  assert.equal(result.summary.incomplete,4);
  assert.equal(result.summary.planDatePast,4);
});
test('upstream rate limit stops all remaining reads and never displays partial board as complete',async()=>{
  const calls=[];
  const base=stub(calls);
  const result=await collectRecentProduction({
    request:async p=>{
      if(calls.length===4){calls.push(p);return response(502,{code:'ms_rate_limited'});}
      return base(p);
    },
    nowMs:NOW
  });
  assert.equal(result.code,'ms_production_board_unverified');
  assert.equal(result.reason,'ms_rate_limited');
  assert.equal(result.requests,5);
  assert.equal(Object.hasOwn(result,'items'),false);
  assert.equal(Object.hasOwn(result,'summary'),false);
});
test('hidden tab/cancellation prevents future API requests',async()=>{
  const calls=[];
  let permitted=true;
  const result=await collectRecentProduction({
    request:async path=>{const r=await stub(calls)(path);return r;},
    pause:async()=>{permitted=false;},
    active:()=>permitted,
    nowMs:NOW
  });
  assert.equal(result.code,'ms_production_board_unverified');
  assert.equal(result.reason,'ms_queue_cancelled');
  assert.equal(calls.length,1);
});
test('two feed pages must share stable snapshot size and unique task IDs/numbers',async()=>{
  const calls=[];
  const result=await collectRecentProduction({
    request:async path=>{
      calls.push(path);
      return response(200,path.endsWith('offset=5')?feed(5,745):feed(0));
    },
    nowMs:NOW
  });
  assert.equal(result.code,'ms_production_board_unverified');
  assert.equal(result.reason,'ms_feed_changed_during_scan');
  assert.equal(calls.length,2);
  assert.equal(Object.hasOwn(result,'items'),false);
  const duplicates=tasks.map(x=>({...x}));
  duplicates[5].number=duplicates[0].number;
  const other=await collectRecentProduction({
    request:stub([],{items:duplicates}),
    nowMs:NOW
  });
  assert.equal(other.reason,'ms_feed_unverified');
  assert.equal(other.requests,2);
});
test('feed validation rejects nonowner payloads, oversized pages and invalid IDs',()=>{
  assert.equal(MAX_TASKS,10);
  assert.equal(REQUEST_DELAY_MS,2000);
  assert.throws(()=>checkProductionFeed({...feed(0),readOnly:false},0));
  assert.throws(()=>checkProductionFeed({...feed(0),selection:'ALL_ACTIVE'},0));
  assert.throws(()=>checkProductionFeed({...feed(0),records:[...tasks.slice(0,6)]},0));
  assert.throws(()=>checkProductionFeed({...feed(0),records:[{...tasks[0],id:'abc'},...tasks.slice(1,5)]},0));
});
test('summary excludes unknown tasks from overdue counts and maintains units separately',()=>{
  const x=summarizeRecentProduction([
    {status:'unverified',planDateStatus:'past'},
    {status:'incomplete',planDateStatus:'past',firstUnfinishedStage:'ОТК'},
    {status:'incomplete',planDateStatus:'today',firstUnfinishedStage:'ОТК'},
    {status:'complete',planDateStatus:'not_applicable'}
  ]);
  assert.equal(x.unverified,1);
  assert.equal(x.planDatePast,1);
  assert.equal(x.planDateToday,1);
  assert.equal(x.firstIncompleteStages[0].tasks,2);
  assert.throws(()=>summarizeRecentProduction(Array(11).fill({status:'complete'})));
});
