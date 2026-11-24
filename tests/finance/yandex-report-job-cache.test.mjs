import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreYandexReportJobs,saveYandexReportJobs}
 from '../../web/office/yandex-finance-job-cache.mjs';
const cache=()=>({map:new Map(),getItem(key){return this.map.get(key)||null;},
 setItem(key,value){this.map.set(key,value);}});
test('Yandex requests resume after refresh without saving credentials',()=>{
 const s=cache(),now=1795510000000;
 const jobs=new Map([['2026-10:all:orders',{
  reportId:'valid_Report_001',status:'PROCESSING',createdAt:now-1000
 }],['2026-10:149082506:services',{
  reportId:'valid_Report_002',status:'DONE',createdAt:now-1000
 }]]);
 assert.equal(saveYandexReportJobs(s,jobs,now),true);
 const data=[...s.map.values()].join('');
 assert.doesNotMatch(data,/YANDEX_MARKET_API_KEY|Api-Key|secret/);
 const result=restoreYandexReportJobs(s,now);
 assert.equal(result.size,2);
 assert.equal(result.get('2026-10:all:orders').status,'PROCESSING');
});
test('old, invalid and out-of-scope jobs are discarded',()=>{
 const s=cache(),now=1795510000000;
 const jobs=new Map([
  ['2026-10:all:orders',{reportId:'valid',status:'DONE',
    createdAt:now-73*60*60*1000}],
  ['2026-10:all:payments',{reportId:'../../unsafe',status:'DONE',
    createdAt:now-1000}],
  ['2026-10:all:services',{reportId:'valid',status:'PENDING',
    createdAt:now-1000}],
  ['2026-10:all:refunds',{reportId:'valid',status:'DONE',
    createdAt:now-1000}]
 ]);
 saveYandexReportJobs(s,jobs,now);
 const recovered=restoreYandexReportJobs(s,now);
 assert.equal(recovered.size,1);
 assert.equal(recovered.has('2026-10:all:services'),true);
});

test('audited completed monthly sources survive 72 hours without re-generation',()=>{
 const s=cache(),now=1795510000000;
 const saved=new Map([
  ['2026-10:all:orders',{reportId:'old-but-audited',status:'DONE',
   createdAt:now-10*24*60*60*1000,audited:true}],
  ['2026-10:149106500:realization',{
   reportId:'no-data-source',status:'FAILED',
   createdAt:now-5*24*60*60*1000,audited:true,
   noData:true,subStatus:'NO_DATA'}]
 ]);
 assert.equal(saveYandexReportJobs(s,saved,now),true);
 const restored=restoreYandexReportJobs(s,now);
 assert.equal(restored.size,2);
 assert.equal(restored.get('2026-10:all:orders').audited,true);
 assert.equal(restored.get('2026-10:149106500:realization').noData,true);
});
test('stale empty-report results and expired completed archives are revisited',()=>{
 const s=cache(),now=1795510000000;
 const jobs=new Map([
  ['2026-10:all:orders',{reportId:'expired',status:'DONE',
   createdAt:now-46*24*60*60*1000,audited:true}],
  ['2026-10:149106500:realization',{reportId:'older-no-data',
   status:'FAILED',createdAt:now-8*24*60*60*1000,
   audited:true,noData:true,subStatus:'NO_DATA'}]
 ]);
 saveYandexReportJobs(s,jobs,now);
 assert.equal(restoreYandexReportJobs(s,now).size,0);
});
