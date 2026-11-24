import test from 'node:test';
import assert from 'node:assert/strict';
import {describeYandexReportSheets}
 from '../../web/office/yandex-report-archive.mjs';
import {reconcileDirectYandexMonth}
 from '../../web/office/yandex-direct-reconciliation-core.mjs';
import {selectYandexMonthlyReportIds,onRequestGet}
 from '../../functions/api/yandex/direct-cost-review.js';
import {interpretYandexDirectCostReview}
 from '../../web/office/yandex-snapshot-dashboard.mjs';

const month='2026-10';
const audit=files=>({code:'yandex_report_archive_audited',
 readOnly:true,changedRecords:0,financeProfitVerified:false,
 sheets:describeYandexReportSheets(files).sheets});
const sources=()=>({
 orders:audit({'services_and_orders_margin.json':[
  {orderId:111,partnerId:149082506,
   incomeWithoutServices:10000,summaryCommission:3000},
  {orderId:222,partnerId:149106500,
   incomeWithoutServices:7000,summaryCommission:2000}]}),
 services:audit({'delivery.json':[{
  partnerId:149082506,servicePrice:100}]}),
 payments:audit({'transaction_date.json':[{
  partnerId:149082506,transactionSum:9000}]})
});
const realization=()=>({
 149082506:audit({'delivered.json':[
  {yourSku:'VESTA',offerName:'Vesta',deliveredCount:2}],
  'returned.json':[
   {yourSku:'VESTA',offerName:'Vesta',returnedCount:1}]}),
 149106500:audit({'delivered.json':[
  {yourSku:'GRANTA',offerName:'Granta',deliveredCount:1}],
  'returned.json':[]})
});
const costs=()=>({code:'unified_finance_source_audit',month,readOnly:true,
 wb:{status:'ready',entries:[
  {vendorCode:'VESTA',costKopecks:420000,status:'confirmed',
   validFrom:'2026-10-01',validTo:null},
  {vendorCode:'GRANTA',costKopecks:320000,status:'confirmed',
   validFrom:'2026-10-01',validTo:null}]},
 ozonCatalog:{entries:[]},ozonProfit:{entries:[]},
 ozonProfitCards:{items:[]}
});
test('all three owner finance reports and two realization reports give SKU contribution, not net',()=>{
 const result=reconcileDirectYandexMonth(month,sources(),realization(),costs());
 assert.equal(result.code,'yandex_direct_cost_review');
 assert.equal(result.status,'preliminary_cost_reconciled');
 assert.equal(result.incomeKopecks,1700000);
 assert.equal(result.cogsKopecks,1160000);
 assert.equal(result.indicativeReturnCostKopecks,420000);
 assert.equal(result.preliminaryContributionKopecks,540000);
 assert.equal(result.netProfitKopecks,null);
 const dashboard=interpretYandexDirectCostReview(month,result);
 assert.equal(dashboard.preliminaryContributionKopecks,540000);
 assert.equal(dashboard.netProfitKopecks,null);
});
test('unknown SKU or empty realization report does not produce false contribution',()=>{
 const catalog=costs();catalog.wb.entries.pop();
 const x=reconcileDirectYandexMonth(month,sources(),realization(),catalog);
 assert.equal(x.status,'incomplete_cost_coverage');
 assert.equal(x.preliminaryContributionKopecks,null);
 assert.equal(x.missing.length,1);
 assert.equal(x.missing[0].shopSku,'GRANTA');
 assert.equal(interpretYandexDirectCostReview(month,x).missingCount,1);
 const r=realization();r[149106500]={code:'yandex_report_no_data'};
 const y=reconcileDirectYandexMonth(month,sources(),r,costs());
 assert.equal(y.preliminaryContributionKopecks,null);
});
test('only five DONE scoped report IDs are valid, never stale or duplicate',()=>{
 const scopes=[
 ['all','orders'],['all','services'],['all','payments'],
 ['149082506','realization'],['149106500','realization']
 ];
 const rows=scopes.map(([scope,report_type],i)=>({
  scope,report_type,report_id:'report_'+i,status:'DONE'}));
 assert.equal(Object.keys(selectYandexMonthlyReportIds(rows)).length,5);
 assert.equal(selectYandexMonthlyReportIds(rows.slice(1)),null);
 assert.equal(selectYandexMonthlyReportIds([...rows,rows[0]]),null);
 assert.equal(selectYandexMonthlyReportIds(
  rows.map((x,i)=>i===4?{...x,status:'FAILED'}:x)),null);
});
test('server-side review needs owner authentication',async()=>{
 const request=new Request('https://office.example/api/yandex/direct-cost-review?month=2026-10');
 const response=await onRequestGet({request,env:{}});
 assert.equal(response.status,503);
 const unknown=new Request('https://office.example/api/yandex/direct-cost-review?month=2026-19');
 const bad=await onRequestGet({request:unknown,env:{}});
 assert.equal(bad.status,400);
});

test('missing realization title is recovered from official seller SKU in orders',()=>{
 const input=sources(), realizationInputs=realization();
 const name='Авточехлы Vesta Cross с оранжевой поддержкой и оранжевыми сотами';
 const orderProducts=audit({'orders_and_offers_transactions.json':[
  {partnerId:149082506,shopSku:'VESTA',offerName:name}
 ]});
 input.orders.sheets.push(...orderProducts.sheets);
 realizationInputs[149082506]=audit({
  'delivered.json':[{yourSku:'VESTA',offerName:'',deliveredCount:2}],
  'returned.json':[{yourSku:'VESTA',offerName:'',returnedCount:1}]
 });
 const catalog=costs();
 catalog.wb.entries=catalog.wb.entries.filter(x=>x.vendorCode!=='VESTA');
 const x=reconcileDirectYandexMonth(month,input,realizationInputs,catalog);
 assert.equal(x.status,'preliminary_cost_reconciled');
 assert.equal(x.cogsKopecks,1220000); // two Vesta Cross at 4,500 + Granta at 3,200
 assert.equal(x.indicativeReturnCostKopecks,450000);
 assert.equal(x.preliminaryContributionKopecks,480000);
 assert.equal(x.netProfitKopecks,null);
});
test('an unnamed seller SKU can use exact title from owner Yandex catalog, never purchasePrice',()=>{
 const reports=realization();
 reports[149082506]=audit({
  'delivered.json':[{yourSku:'VESTA',offerName:'',deliveredCount:2}],
  'returned.json':[{yourSku:'VESTA',offerName:'',returnedCount:1}]
 });
 const catalog=costs();
 catalog.wb.entries=catalog.wb.entries.filter(x=>x.vendorCode!=='VESTA');
 const x=reconcileDirectYandexMonth(month,sources(),reports,catalog,{
  catalogOfferNames:{VESTA:'Авточехлы Vesta Cross оранжевая поддержка, оранжевые соты'}
 });
 assert.equal(x.status,'preliminary_cost_reconciled');
 assert.equal(x.cogsKopecks,1220000);
});
