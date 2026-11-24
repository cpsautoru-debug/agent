import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
import {buildYandexPreliminaryContribution}
 from '../../web/office/yandex-contribution-core.mjs';
const report=files=>({code:'yandex_report_archive_audited',
 readOnly:true,changedRecords:0,financeProfitVerified:false,
 sheets:describeYandexReportSheets(files).sheets});
const sources=()=>({
 orders:report({'services_and_orders_margin.json':[
  {orderId:100,partnerId:149082506,
   incomeWithoutServices:10000,summaryCommission:3000},
  {orderId:101,partnerId:149106500,
   incomeWithoutServices:7000,summaryCommission:2000}]}),
 services:report({'delivery.json':[
  {partnerId:149082506,servicePrice:100}]}),
 payments:report({'transaction_date.json':[
  {partnerId:149082506,transactionSum:9000}]})
});
const costs=()=>({month:'2026-10',rows:[
 {partnerId:149082506,shopSku:'VESTA',
  costKopecks:420000,status:'matched_exact'},
 {partnerId:149106500,shopSku:'GRANTA',
  costKopecks:320000,status:'matched_owner'}
]});
const realizations=()=>({
 149082506:report({'delivered.json':[
  {yourSku:'VESTA',offerName:'Vesta',deliveredCount:2}],
  'returned.json':[
  {yourSku:'VESTA',offerName:'Vesta',returnedCount:1}]}),
 149106500:report({'delivered.json':[
  {yourSku:'GRANTA',offerName:'Granta',deliveredCount:1}],
  'returned.json':[]})
});
test('full audited Yandex sources yield only provisional contribution, no double fees',()=>{
 const value=buildYandexPreliminaryContribution(sources(),costs(),realizations());
 assert.equal(value.status,'preliminary_contribution_ready');
 assert.equal(value.orderAfterServicesKopecks,1700000);
 assert.equal(value.deliveredManufacturingCostKopecks,1160000);
 assert.equal(value.returnsIndicativeCostKopecks,420000);
 assert.equal(value.preliminaryContributionKopecks,540000);
 assert.equal(value.netProfitKopecks,null);
 assert.deepEqual(value.blockers,[]);
});
test('NO_DATA second store cannot fabricate positive provisional contribution',()=>{
 const input=realizations();
 input[149106500]={code:'yandex_report_no_data'};
 const result=buildYandexPreliminaryContribution(sources(),costs(),input);
 assert.equal(result.status,'incomplete');
 assert.equal(result.preliminaryContributionKopecks,null);
 assert.ok(result.blockers.includes('both_shops_delivery_return_cost_incomplete'));
});
test('unknown one-unit cost prevents an artificial contribution number',()=>{
 const input=costs();
 input.rows.pop();
 const result=buildYandexPreliminaryContribution(sources(),input,realizations());
 assert.equal(result.preliminaryContributionKopecks,null);
 assert.equal(result.missing.length,1);
 assert.equal(result.missing[0].shopSku,'GRANTA');
});
test('missing official finance services and invalid ownership evidence reject profit',()=>{
 const s=sources();s.services.sheets[0].sumFields.servicePrice.present=0;
 const result=buildYandexPreliminaryContribution(s,costs(),realizations());
 assert.equal(result.status,'incomplete');
 assert.ok(result.blockers.includes('service_amount_coverage_incomplete'));
 assert.equal(result.preliminaryContributionKopecks,null);
 const s2=sources();s2.orders.readOnly=false;
 const result2=buildYandexPreliminaryContribution(s2,costs(),realizations());
 assert.ok(result2.blockers.includes('financial_sources_not_verified'));
 assert.equal(result2.preliminaryContributionKopecks,null);
});
test('monthly finance event reuses already read sources without another three API downloads',()=>{
 const finance=readFileSync(new URL('../../web/office/yandex-finance-audit-ui.mjs',import.meta.url),'utf8');
 const costs=readFileSync(new URL('../../web/office/yandex-cost-crosswalk-ui.mjs',import.meta.url),'utf8');
 assert.match(finance,/yandex-financial-sources-audited/);
 assert.match(costs,/buildYandexPreliminaryContribution/);
 assert.match(costs,/financeEvidence\.set/);
 assert.doesNotMatch(costs,/netProfitKopecks\s*=\s*0/);
});
