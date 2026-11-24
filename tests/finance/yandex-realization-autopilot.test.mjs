import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPaths} from '../../functions/api/yandex/finance-source.js';
import {describeYandexReportSheets} from '../../web/office/yandex-report-archive.mjs';
import {summarizedRealization,classifyYandexReportStatus,isClosedYandexMonth} from '../../web/office/yandex-autopilot.mjs';
import {saveYandexReportJobs,restoreYandexReportJobs} from '../../web/office/yandex-finance-job-cache.mjs';
import {readFileSync} from 'node:fs';

const audited=sheets=>({code:'yandex_report_archive_audited',
 readOnly:true,sheets});

test('goods realization follows official per-shop monthly report path',()=>{
 assert.equal(reportPaths.realization,'goods-realization');
 const code=readFileSync(new URL('../../functions/api/yandex/finance-reports.js',import.meta.url),'utf8');
 assert.match(code,/realization_requires_single_campaign/);
 assert.match(code,/campaignId:selected\[0\]/);
 assert.match(code,/year:Number\(params\.month\.slice/);
});

test('delivered and returned sheets count separately without duplicate subtraction',()=>{
 const files={
  'delivered.json':[
   {yourSku:'SKU1',deliveredCount:2},
   {yourSku:'SKU2',deliveredCount:1}],
  'returned.json':[
   {yourSku:'SKU1',deliveredCount:2,returnedCount:1}]};
 const sheets=describeYandexReportSheets(files).sheets;
 assert.equal(sheets[0].quantityTotals.deliveredCount.total,3);
 assert.equal(sheets[1].quantityTotals.returnedCount.total,1);
 assert.deepEqual(summarizedRealization(audited(sheets)),
  {delivered:3,returned:1});
 assert.equal(sheets[0].realizationSkuSummaries[0].units,2);
 assert.equal(sheets[1].realizationSkuSummaries[0].units,1);
});

test('missing delivered sheet and incomplete row quantities never become zero',()=>{
 const sheets=describeYandexReportSheets({
  'delivered.json':[
   {yourSku:'SKU1',deliveredCount:2},
   {yourSku:'SKU2'}],
  'returned.json':[]
 }).sheets;
 assert.deepEqual(summarizedRealization(audited(sheets)),
  {delivered:null,returned:0});
 assert.deepEqual(summarizedRealization(audited(
  sheets.filter(s=>s.sheet!=='returned.json'))),
  {delivered:null,returned:null});
});

test('new mixed transaction quantity uses the source field, not sold units',()=>{
 const sheet=describeYandexReportSheets({
  'orders_and_offers_transactions.json':[
   {partnerId:149082506,shopSku:'SKU1',deliveredOrReturned:2,
    offerStatus:'DELIVERED'},
   {partnerId:149082506,shopSku:'SKU1',deliveredOrReturned:1,
    offerStatus:'RETURNED'}
  ]
 }).sheets[0];
 assert.equal(sheet.skuCandidates[0].reportedQuantity,3);
 assert.deepEqual(sheet.skuCandidates[0].quantitySources,['deliveredOrReturned']);
 assert.equal(sheet.skuCandidates[0].soldUnits,undefined);
});

test('owner-only Yandex autopilot is loaded and does not embed credentials',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const code=readFileSync(new URL('../../web/office/yandex-autopilot.mjs',import.meta.url),'utf8');
 assert.match(html,/yandex-autopilot\.mjs/);
 assert.match(code,/announcedMonth!==month/);
 assert.doesNotMatch(code,/Api-Key|YANDEX_MARKET_API_KEY/);
});

test('official NO_DATA is a verified absence of report, never zero delivered',()=>{
 for(const state of ['FAILED','DONE']){
  assert.deepEqual(classifyYandexReportStatus({
   code:'yandex_report_status',status:state,
   subStatus:'NO_DATA',fileAvailable:false}),{kind:'no_data'});
 }
 assert.deepEqual(classifyYandexReportStatus({
  code:'yandex_report_status',status:'DONE',
  subStatus:null,fileAvailable:false}),{kind:'awaiting_file'});
 assert.deepEqual(classifyYandexReportStatus({
  code:'yandex_report_status',status:'DONE',
  subStatus:null,fileAvailable:true}),{kind:'audit'});
 assert.deepEqual(classifyYandexReportStatus({
  code:'yandex_report_status',status:'FAILED',
  subStatus:'TOO_LARGE',fileAvailable:false}),
  {kind:'failed',reason:'TOO_LARGE'});
 assert.deepEqual(classifyYandexReportStatus({
  code:'yandex_report_status',status:'PROCESSING',
  subStatus:null,fileAvailable:false}),{kind:'waiting'});
});

test('NO_DATA state survives browser reload and never becomes fabricated zero',()=>{
 const saved=new Map(),mem=new Map();
 const now=Date.parse('2026-11-24T10:00:00Z');
 saved.set('2026-10:149106500:realization',{
  reportId:'safe-report-id',status:'FAILED',
  createdAt:now-60000,audited:true,noData:true,subStatus:'NO_DATA'});
 const storage={getItem:key=>mem.get(key)||null,
  setItem:(key,value)=>mem.set(key,value)};
 assert.equal(saveYandexReportJobs(storage,saved,now),true);
 const after=restoreYandexReportJobs(storage,now);
 assert.equal(after.size,1);
 assert.deepEqual(after.get('2026-10:149106500:realization'),
  saved.get('2026-10:149106500:realization'));
});

test('auto-reports never start for current or future unclosed month',()=>{
 const now=Date.parse('2026-11-24T10:00:00Z');
 assert.equal(isClosedYandexMonth('2026-11',now),false);
 assert.equal(isClosedYandexMonth('2026-12',now),false);
 assert.equal(isClosedYandexMonth('2026-10',now),true);
 assert.equal(isClosedYandexMonth('bad',now),false);
});
