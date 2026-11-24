import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeYandexJob,onRequestGet,onRequestPost}
 from '../../functions/api/yandex/report-jobs.js';
import {mergeYandexRemoteJobs}
 from '../../web/office/yandex-finance-job-cache.mjs';
const now=Date.parse('2026-11-24T14:00:00Z');
const job=(more={})=>({
 month:'2026-10',scope:'149082506',reportType:'realization',
 reportId:'safe-report-id',status:'DONE',createdAt:now-100000,
 ...more
});
test('owner metadata registry admits only official closed monthly report scopes',()=>{
 const x=safeYandexJob(job(),now);
 assert.equal(x.scope,'149082506');
 assert.equal(x.reportId,'safe-report-id');
 assert.equal(x.createdAt,new Date(now-100000).toISOString());
 assert.equal(safeYandexJob(job({scope:'all'}),now),null);
 assert.equal(safeYandexJob(job({month:'2026-11'}),now),null);
 assert.equal(safeYandexJob(job({reportType:'orders'}),now),null);
 assert.equal(safeYandexJob(job({reportId:'../unsafe'}),now),null);
 assert.equal(safeYandexJob(job({createdAt:now+1000}),now),null);
 assert.equal(safeYandexJob(job({createdAt:now-46*86400000}),now),null);
 assert.equal(safeYandexJob(job({apiKey:'nope'}),now),null);
});
test('server report registry rejects cross-site writes and requires owner session',async()=>{
 const cross=new Request('https://example.com/api/yandex/report-jobs',{
  method:'POST',headers:{Origin:'https://evil.example',
   'Content-Type':'application/json'},body:JSON.stringify(job())});
 let res=await onRequestPost({request:cross,env:{}});
 assert.equal(res.status,403);
 const local=new Request('https://example.com/api/yandex/report-jobs',{
  method:'POST',headers:{Origin:'https://example.com',
   'Content-Type':'application/json'},body:JSON.stringify(job())});
 res=await onRequestPost({request:local,env:{}});
 assert.equal(res.status,503);
 res=await onRequestGet({request:new Request(
  'https://example.com/api/yandex/report-jobs?month=2026-10'),env:{}});
 assert.equal(res.status,503);
});
test('server metadata merge preserves audited browser evidence and never downgrades it',()=>{
 const local=new Map([['2026-10:149082506:realization',{
  reportId:'safe-report-id',status:'DONE',createdAt:now-100000,
  audited:true,noData:false,subStatus:null}]]);
 const remote=[job({status:'PROCESSING'})];
 const merged=mergeYandexRemoteJobs(local,remote,now);
 assert.equal(merged.get('2026-10:149082506:realization').status,'DONE');
 assert.equal(merged.get('2026-10:149082506:realization').audited,true);
 const newer=[job({reportId:'new-server-report',createdAt:now-10})];
 const after=mergeYandexRemoteJobs(merged,newer,now);
 assert.equal(after.get('2026-10:149082506:realization').reportId,'new-server-report');
 assert.equal(after.get('2026-10:149082506:realization').audited,false);
});
test('browser autopilot performs owner-bound metadata sync without storing raw financial rows',()=>{
 const js=readFileSync(new URL('../../web/office/yandex-autopilot.mjs',import.meta.url),'utf8');
 assert.match(js,/\/api\/yandex\/report-jobs/);
 assert.match(js,/mergeYandexRemoteJobs/);
 assert.match(js,/yandex_report_jobs_uninitialized/);
 assert.doesNotMatch(js,/Api-Key|YANDEX_MARKET_API_KEY/);
});
