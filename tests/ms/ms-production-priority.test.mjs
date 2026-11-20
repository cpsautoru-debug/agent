import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriorityNumbers,verifyExactTaskFeed,collectPriorityProduction,
  buildPriorityCsv,MAX_PRIORITY_TASKS,PRIORITY_DELAY_MS
} from '../../web/office/ms-production-priority-core.mjs';

const uuid=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const NOW=Date.parse('2026-11-20T10:00:00Z');
const record=(number,i)=>({
  id:uuid(i),number,date:'2026-11-20 12:00:00.000',
  plannedDate:i%2===0?'2026-11-19 10:00:00.000':null,documentPosted:true
});
const feed=(number,i,total=1,items=[record(number,i)])=>({
  code:'ms_production_feed_ok',readOnly:true,changedRecords:0,
  totalAllTime:null,totalMatching:total,
  selection:'EXACT_DOCUMENT_NUMBER_NOT_ACTIVE_TASKS',
  searchNumber:number,pageSize:5,offset:0,records:items
});
const stage=(done,complete)=>({
  code:'ms_production_stages_ok',plan:3,
  finishedFinalStage:done,rowChainsVerified:true,
  rowChainStatus:complete?'complete':'incomplete',
  firstUnfinishedRowStage:complete?null:'Раскрой материала',
  stages:[{order:0,name:'Раскрой материала',plan:3,done}]
});
const resp=(status,body)=>({status,body});
const set=['00740','00741','00742','00743','00744'];

test('parse exact production numbers without losing leading zeros',()=>{
  assert.equal(MAX_PRIORITY_TASKS,5);
  assert.equal(PRIORITY_DELAY_MS,2000);
  assert.deepEqual(parsePriorityNumbers(' 00740, 00741\n00742;00743 00744 '),set);
  assert.deepEqual(parsePriorityNumbers('0000000001'),['0000000001']);
  for(const invalid of [
    '', ' ', '00740,00740','00740,00741,00742,00743,00744,00745',
    '1.2','-5','+5','foo','\u0000','001/002','0'.repeat(125),null,123
  ])assert.throws(()=>parsePriorityNumbers(invalid),String(invalid).slice(0,30));
});
test('five real exact documents: at most ten sequential GET, matching IDs, correct stages and date statuses',async()=>{
  const paths=[],delays=[],progress=[];
  const result=await collectPriorityProduction({
    numbers:set,
    nowMs:NOW,
    pause:async ms=>delays.push(ms),
    active:()=>true,
    onProgress:x=>progress.push(x),
    request:async path=>{
      paths.push(path);
      const url=new URL('https://example.invalid'+path);
      if(url.pathname.endsWith('/production-feed')){
        const number=url.searchParams.get('number');
        const index=set.indexOf(number);
        assert.ok(index>=0);
        return resp(200,feed(number,index));
      }
      assert.equal(url.pathname,'/api/ms/production-stages');
      const i=Number.parseInt(url.searchParams.get('taskId').slice(-12),16);
      return resp(200,stage(i%2===0?1:3,i%2!==0));
    }
  });
  assert.equal(result.code,'ms_priority_production_ok');
  assert.equal(result.scope,'EXACT_USER_SELECTED_TASK_NUMBERS_NOT_ALL_ACTIVE_ORDERS');
  assert.equal(result.requests,10);
  assert.deepEqual(result.numbers,set);
  assert.equal(result.items.length,5);
  assert.equal(result.summary.checked,5);
  assert.equal(result.summary.incomplete,3);
  assert.equal(result.summary.complete,2);
  assert.equal(result.summary.unverified,0);
  assert.equal(result.summary.planDatePast,3);
  assert.equal(result.items[0].number,'00740');
  assert.equal(result.items[0].remaining,2);
  assert.equal(result.items[0].planDateStatus,'past');
  assert.equal(result.items[1].status,'complete');
  assert.equal(result.items[1].planDateStatus,'not_applicable');
  assert.equal(paths.length,10);
  assert.deepEqual(paths.slice(0,2),[
    '/api/ms/production-feed?number=00740',
    '/api/ms/production-stages?taskId='+uuid(0)
  ]);
  assert.deepEqual(delays,Array(9).fill(2000));
  assert.equal(progress.length,5);
  assert.equal(result.changedRecords,0);
  assert.doesNotMatch(JSON.stringify(result),/Bearer|apiKey|access-token/);
});
test('missing number does not become a completed task or a claim of no active work',async()=>{
  const paths=[];
  const r=await collectPriorityProduction({
    numbers:['00740','00741'],nowMs:NOW,
    request:async path=>{
      paths.push(path);
      if(path.endsWith('00740'))return resp(200,feed('00740',0,0,[]));
      if(path.endsWith('00741'))return resp(200,feed('00741',1));
      return resp(200,stage(3,true));
    }
  });
  assert.equal(r.code,'ms_priority_production_ok');
  assert.equal(r.items[0].status,'unverified');
  assert.equal(r.items[0].code,'task_not_found');
  assert.equal(r.items[0].remaining,undefined);
  assert.equal(r.summary.unverified,1);
  assert.equal(r.summary.complete,1);
  assert.equal(r.requests,3);
});
test('duplicate matching names and mismatched results fail closed instead of accepting first row',()=>{
  assert.equal(verifyExactTaskFeed(feed('00740',0,0,[]),'00740'),null);
  assert.throws(()=>verifyExactTaskFeed(feed('00740',0,2,[record('00740',0)]),'00740'));
  assert.throws(()=>verifyExactTaskFeed(feed('00741',0),'00740'));
  assert.throws(()=>verifyExactTaskFeed({...feed('00740',0),selection:'ALL_ACTIVE'},'00740'));
  assert.throws(()=>verifyExactTaskFeed({...feed('00740',0),changedRecords:1},'00740'));
  assert.throws(()=>verifyExactTaskFeed(feed('00740',0,1,[{...record('00740',0),id:'bad'}]),'00740'));
});
test('unverified stage quantities remain unknown, never reported as zero or overdue',async()=>{
  const r=await collectPriorityProduction({
    numbers:['00740'],nowMs:NOW,
    request:async path=>resp(200,path.includes('production-feed')?
      feed('00740',0):
      {...stage(3,true),rowChainsVerified:false,rowChainStatus:'unverified'})
  });
  assert.equal(r.code,'ms_priority_production_ok');
  assert.equal(r.items[0].status,'unverified');
  assert.equal(r.items[0].remaining,undefined);
  assert.equal(r.items[0].planDateStatus,'unverified');
  assert.equal(r.summary.planDatePast,0);
});
test('API 429 stops, returns no partial worklist or misleading totals',async()=>{
  const paths=[];
  const r=await collectPriorityProduction({
    numbers:set,request:async path=>{
      paths.push(path);
      if(paths.length===3)return resp(502,{code:'ms_rate_limited'});
      if(path.includes('production-feed'))return resp(200,feed('00740',0));
      return resp(200,stage(1,false));
    }
  });
  assert.equal(r.code,'ms_priority_production_unverified');
  assert.equal(r.reason,'ms_rate_limited');
  assert.equal(r.requests,3);
  assert.equal(Object.hasOwn(r,'items'),false);
  assert.equal(Object.hasOwn(r,'summary'),false);
});
test('cancellation after first request prevents further server calls',async()=>{
  let on=true,calls=0;
  const r=await collectPriorityProduction({
    numbers:['00740'],active:()=>on,
    pause:async()=>{on=false;},
    request:async()=>{calls++;return resp(200,feed('00740',0));}
  });
  assert.equal(r.reason,'ms_priority_cancelled');
  assert.equal(calls,1);
});
test('CSV is UTF-8, bounded, formula-safe, and does not fabricate missing amounts',()=>{
  const data=[{number:'00740',status:'incomplete',remaining:2,
    firstUnfinishedStage:'=HYPERLINK("https://evil.invalid")',
    plannedDate:null,planDateStatus:'not_set'},
    {number:'00741',status:'unverified',code:'task_not_found'}];
  const csv=buildPriorityCsv(data);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv,/00740/);
  assert.match(csv,/Не подтверждено/);
  assert.match(csv,/'=HYPERLINK/);
  assert.match(csv,/не вся текущая очередь производства/);
  assert.equal(csv.split('\r\n').length,4);
  assert.throws(()=>buildPriorityCsv(Array(6).fill({number:'00001'})));
  assert.throws(()=>buildPriorityCsv([{number:'../evil'}]));
});
