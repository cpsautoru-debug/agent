import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
import {deriveYandexDashboardEvidence,loadYandexDashboardEvidence}
 from '../../web/office/yandex-dashboard-evidence.mjs';
import {saveYandexReportJobs}
 from '../../web/office/yandex-finance-job-cache.mjs';

const audit=files=>({code:'yandex_report_archive_audited',readOnly:true,
 changedRecords:0,financeProfitVerified:false,
 sheets:describeYandexReportSheets(files).sheets});
const source=()=>({
 orders:audit({'services_and_orders_margin.json':[
  {orderId:100,partnerId:149082506,
   incomeWithoutServices:9000,summaryCommission:1000},
  {orderId:101,partnerId:149106500,
   incomeWithoutServices:7000,summaryCommission:900}
 ]}),
 services:audit({'delivery.json':[{
  partnerId:149082506,servicePrice:100
 }]}),
 payments:audit({'transaction_date.json':[{
  partnerId:149082506,transactionSum:4500
 }]})
});
const paths={
 order:'/api/yandex/report-audit?reportId=orders_verified',
 service:'/api/yandex/report-audit?reportId=services_verified',
 payment:'/api/yandex/report-audit?reportId=payments_verified'
};
const makeStorage=()=>{
 const db=new Map();
 return {getItem:key=>db.get(key)||null,
  setItem:(key,value)=>db.set(key,value)};
};
test('main dashboard shows exactly same incomeWithoutServices as finance section',()=>{
 const s=source(),e=deriveYandexDashboardEvidence('2026-10',s);
 assert.equal(e.status,'order_income_verified');
 assert.equal(e.incomeKopecks,1600000);
 assert.equal(e.includedServicesKopecks,190000);
 assert.equal(e.orders,2);
 assert.equal(e.netProfitKopecks,null);
 assert.equal(e.serviceAuditComplete,true);
 assert.equal(e.paymentAuditComplete,true);
});
test('no store payouts/services/commissions are added to Yandex income',()=>{
 const s=source();
 s.services.sheets[0].sumFields.servicePrice.totalKopecks=99999999;
 s.payments.sheets[0].sumFields.transactionSum.totalKopecks=88888888;
 assert.equal(deriveYandexDashboardEvidence('2026-10',s).incomeKopecks,1600000);
});
test('incomplete order coverage and invalid source prevent dashboard amount',()=>{
 const x=source();
 x.orders.sheets[0].duplicateOrderIds=1;
 assert.equal(deriveYandexDashboardEvidence('2026-10',x).incomeKopecks,null);
 x.orders=source().orders;
 x.services.readOnly=false;
 assert.equal(deriveYandexDashboardEvidence('2026-10',x).status,'unavailable');
});
test('live read uses only archived IDs with owner GET and never invents absence as zero',async()=>{
 const storage=makeStorage(),now=Date.now();
 const jobs=new Map([
  ['2026-10:all:orders',{reportId:'orders_verified',status:'DONE',
   createdAt:now-300000,audited:true}],
  ['2026-10:all:services',{reportId:'services_verified',status:'DONE',
   createdAt:now-300000,audited:true}],
  ['2026-10:all:payments',{reportId:'payments_verified',status:'DONE',
   createdAt:now-300000,audited:true}]
 ]);
 saveYandexReportJobs(storage,jobs,now);
 const contents=source(),used=[];
 const lookup={
  [paths.order]:contents.orders,
  [paths.service]:contents.services,
  [paths.payment]:contents.payments
 };
 const fetcher=async(path,options)=>{
  used.push({path,options});
  assert.equal(options.method,'GET');
  assert.equal(options.credentials,'same-origin');
  assert.ok(lookup[path]);
  return {ok:true,json:async()=>lookup[path]};
 };
 const evidence=await loadYandexDashboardEvidence({
  month:'2026-10',storage,fetcher,force:true});
 assert.equal(evidence.incomeKopecks,1600000);
 assert.equal(used.length,3);
 assert.equal(evidence.netProfitKopecks,null);
 const noIds=await loadYandexDashboardEvidence({
  month:'2026-09',storage,fetcher});
 assert.equal(noIds.incomeKopecks,null);
 assert.equal(noIds.status,'unavailable');
 assert.equal(used.length,3);
});
test('dashboard and overall P&L have exactly one sourced Yandex interim metric',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const board=readFileSync(new URL('../../web/office/ceo-dashboard.mjs',import.meta.url),'utf8');
 const business=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 const finance=readFileSync(new URL('../../web/office/yandex-finance-audit-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/id="ceoYandexValue"/);
 assert.match(html,/id="ceoYandexState"/);
 assert.match(board,/loadYandexDashboardEvidence/);
 assert.match(board,/yandex-financial-sources-audited/);
 assert.match(finance,/yandex-financial-sources-audited/);
 assert.match(business,/yandexInterim/);
 assert.match(business,/interim\.yandex\.incomeKopecks/);
 assert.match(business,/Нет закрытого расчёта/);
 assert.doesNotMatch(board,/617[\s\u00a0]?792/);
});
