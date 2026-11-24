import test from 'node:test';
import assert from 'node:assert/strict';
import {describeYandexReportSheets} from '../../web/office/yandex-report-archive.mjs';
import {reconcileYandexRealizationCosts,collectYandexRealizationCandidates}
 from '../../web/office/yandex-realization-cost-evidence.mjs';
import {readFileSync} from 'node:fs';
const archive=(files)=>({code:'yandex_report_archive_audited',
 readOnly:true,changedRecords:0,
 sheets:describeYandexReportSheets(files).sheets});
const r1=()=>archive({'delivered.json':[
 {yourSku:'VESTA',offerName:'Чехлы Vesta',deliveredCount:2},
 {yourSku:'PRIORA',offerName:'Чехлы Priora',deliveredCount:1}],
 'returned.json':[
 {yourSku:'VESTA',offerName:'Чехлы Vesta',returnedCount:1}]});
const r2=()=>archive({'delivered.json':[],
 'returned.json':[]});
const audit=()=>({month:'2026-10',rows:[
 {partnerId:149082506,shopSku:'VESTA',costKopecks:420000,status:'matched_exact'},
 {partnerId:149082506,shopSku:'PRIORA',costKopecks:319900,status:'matched_owner'}
]});
test('matched Yandex delivered and returned SKU cost stays separate from profit',()=>{
 const x=reconcileYandexRealizationCosts(audit(),{
  149082506:r1(),149106500:r2()});
 assert.equal(x.status,'two_shops_cost_verified');
 assert.equal(x.byShop[0].deliveredUnits,3);
 assert.equal(x.byShop[0].returnedUnits,1);
 assert.equal(x.byShop[0].deliveredCostKopecks,1159900);
 assert.equal(x.byShop[0].returnedValueKopecks,420000);
 assert.equal(x.totalDeliveredCostKopecks,1159900);
 assert.equal(x.totalReturnedValueKopecks,420000);
 assert.equal(x.netProfitKopecks,null);
});
test('model-level cost guesses never produce verified delivery cost',()=>{
 const data=audit();
 data.rows[0].status='matched_model';
 const result=reconcileYandexRealizationCosts(data,{
  149082506:r1(),149106500:r2()});
 assert.equal(result.status,'reconciliation_incomplete');
 assert.equal(result.byShop[0].unknownDeliveredUnits,2);
 assert.equal(result.byShop[0].deliveredCostKopecks,null);
 assert.equal(result.netProfitKopecks,null);
});
test('missing physical SKU cost blocks totals and exposes real product names',()=>{
 const data=audit();data.rows=data.rows.filter(x=>x.shopSku!=='PRIORA');
 const x=reconcileYandexRealizationCosts(data,{
  149082506:r1(),149106500:r2()});
 assert.equal(x.status,'reconciliation_incomplete');
 assert.equal(x.totalDeliveredCostKopecks,null);
 assert.equal(x.byShop[0].confirmedDeliveredCostKopecks,840000);
 assert.equal(x.byShop[0].unknownDeliveredUnits,1);
 assert.deepEqual(x.missing,[{partnerId:149082506,shopSku:'PRIORA',
  name:'Чехлы Priora',deliveredUnits:1,returnedUnits:0}]);
});
test('NO_DATA and absent second shop do not imply zero sales and cost',()=>{
 const a=reconcileYandexRealizationCosts(audit(),{
  149082506:r1(),149106500:{code:'yandex_report_no_data'}});
 assert.equal(a.byShop[1].status,'no_data');
 assert.equal(a.byShop[1].deliveredUnits,null);
 assert.equal(a.totalDeliveredCostKopecks,null);
 const b=reconcileYandexRealizationCosts(audit(),{149082506:r1()});
 assert.equal(b.byShop[1].status,'not_ready');
 assert.equal(b.totalDeliveredCostKopecks,null);
});
test('missing or invalid item codes never turn into confirmed cost',()=>{
 const partial=archive({'delivered.json':[
  {yourSku:'VESTA',deliveredCount:1},
  {yourSku:'',deliveredCount:1}],
  'returned.json':[]});
 const x=reconcileYandexRealizationCosts(audit(),{
  149082506:partial,149106500:r2()});
 assert.equal(x.byShop[0].deliveredReportStatus,'sku_coverage_incomplete');
 assert.equal(x.byShop[0].deliveredCostKopecks,null);
 assert.equal(x.totalDeliveredCostKopecks,null);
});
test('report realization reveals SKU not listed in order transactions',()=>{
 const x=collectYandexRealizationCandidates({
  149082506:r1(),149106500:r2()});
 assert.deepEqual(x,[{partnerId:149082506,shopSku:'VESTA',
  offerName:'Чехлы Vesta'},
  {partnerId:149082506,shopSku:'PRIORA',offerName:'Чехлы Priora'}]);
});
test('Yandex page automatically reads realization reports and matches costs',()=>{
 const js=readFileSync(new URL('../../web/office/yandex-cost-crosswalk-ui.mjs',import.meta.url),'utf8');
 assert.match(js,/yandex-auto-jobs-updated/);
 assert.match(js,/reconcileYandexRealizationCosts/);
 assert.match(js,/collectYandexRealizationCandidates/);
 assert.doesNotMatch(js,/netProfitKopecks\s*:\s*0/);
});
