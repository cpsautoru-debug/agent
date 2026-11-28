import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sadUnitEvidence,wbContributionRanking,sadQuantityEvidence,attachSadWbCostReview,sadOrderReview} from '../web/office/shop-unit-evidence.mjs';
const m='2026-10';
const item={partnerId:149082506,shopSku:'A',name:'Чехлы',deliveredUnits:4,returnedUnits:1,costKopecks:370000,costStatus:'matched_owner'};
const d={code:'yandex_month_evidence_available',month:m,readOnly:true,sourceKind:'owner_browser_audited_summary',evidence:{ownerEntity:'ИП Жилина Ольга',netProfitKopecks:null,orderAfterServiceKopecks:99999999,skus:[item,{...item,partnerId:149106500,shopSku:'B'}],issues:[]}};
test('SAD evidence isolates campaign and never attributes combined revenue',()=>{const r=sadUnitEvidence(m,d);assert.equal(r.length,1);assert.equal(r[0].sku,'A');assert.equal(r[0].total,1480000);for(const k of ['payout','contribution','netProfit','approvedBudget'])assert.equal(r[0][k],null);});
test('SAD rejects incomplete scope and duplicate SKU; unknown costs stay null',()=>{assert.equal(sadUnitEvidence('2026-11',d),null);assert.equal(sadUnitEvidence(m,{...d,evidence:{...d.evidence,issues:[{partnerId:149082506,reason:'missing'}]}}),null);assert.equal(sadUnitEvidence(m,{...d,evidence:{...d.evidence,skus:[item,item]}}),null);const [r]=sadUnitEvidence(m,{...d,evidence:{...d.evidence,skus:[{...item,costStatus:'missing'}]}});assert.equal(r.cost,null);assert.equal(r.total,null);});
test('rank only known WB contribution and never grant advertising budget',()=>{const r=wbContributionRanking([{sku:'A',sold:4,contribution:null},{sku:'B',sold:2,contribution:-100},{sku:'C',sold:1,contribution:200}]);assert.deepEqual(r.map(x=>x.sku),['C','B']);assert.match(r[1].signal,/Отрицательный/);assert.ok(r.every(x=>x.netProfit===null&&x.approvedBudget===null));});
test('mobile layout and SAD controls are scoped to analytics',()=>{const html=readFileSync(new URL('../web/office/index.html',import.meta.url),'utf8');const css=readFileSync(new URL('../web/office/shop-analytics.css',import.meta.url),'utf8');const start=html.indexOf('data-section="analytics"'),end=html.indexOf('data-section="finance"',start);for(const id of ['unitSadRows','unitSadLoad','unitWbSort'])assert.ok(html.slice(start,end).includes('id="'+id+'"'));assert.match(css,/@media\(max-width:700px\)/);assert.ok(css.includes('#unitWbRows td:nth-child(8)'));assert.ok(html.includes('shop-unit-evidence-ui.mjs'));});

test('SAD fallback only accepts reconciled quantities and keeps all money unknown',()=>{
 const d={code:'sad_sales_sku',month:m,campaignId:149082506,readOnly:true,changedRecords:0,coverageComplete:true,rows:[{sku:'A',name:'A',sold:4,returned:1,cost:123}]};
 const r=sadQuantityEvidence(m,d);assert.equal(r.length,1);assert.equal(r[0].sold,4);for(const k of ['cost','total','payout','contribution','netProfit','approvedBudget'])assert.equal(r[0][k],null);
 for(const patch of [{campaignId:149106500},{coverageComplete:false},{changedRecords:1},{month:'2026-11'},{rows:[d.rows[0],d.rows[0]]}])assert.equal(sadQuantityEvidence(m,{...d,...patch}),null);
});

test('exact historical WB norms remain review candidates, never confirmed SAD costs',()=>{
 const rows=[{sku:'A',sold:7,cost:null,total:null,netProfit:null,approvedBudget:null}];
 const entry={vendorCode:'A',validFrom:'2026-10-01',validTo:'2026-10-31',costKopecks:10000,status:'confirmed'};
 const a={code:'unified_finance_source_audit',month:m,readOnly:true,changedRecords:0,wb:{status:'ready',entries:[entry]}};
 const [r]=attachSadWbCostReview(m,rows,a);assert.equal(r.candidateCost,10000);assert.equal(r.candidateTotal,70000);assert.equal(r.cost,null);assert.equal(r.total,null);assert.equal(r.approvedBudget,null);
 for(const entries of [[{...entry,vendorCode:'a'}],[{...entry,status:'preliminary'}],[{...entry,validTo:'2026-10-30'}],[entry,{...entry,costKopecks:20000}]])assert.equal(attachSadWbCostReview(m,rows,{...a,wb:{status:'ready',entries}})[0].candidateCost,undefined);
 assert.equal(attachSadWbCostReview('2026-11',rows,{...a,month:'2026-11'})[0].candidateCost,undefined);
});
test('SAD order coverage does not allocate whole order income to an individual SKU',()=>{
 const jobs={code:'yandex_report_jobs_saved',readOnly:true,jobs:[{month:m,scope:'all',reportType:'orders',status:'DONE'},{month:m,scope:'149082506',reportType:'realization',status:'DONE'}]};
 const audit=sheets=>({code:'yandex_report_archive_audited',readOnly:true,changedRecords:0,sheets});
 const orders=audit([{sheet:'services_and_orders_margin.json',rows:1,duplicateOrderIds:0,ordersWithIds:1,marginOrderLedger:[{orderId:'1',incomeKopecks:12345}]}]);
 const realization=audit([{sheet:'delivered.json',rows:3,deliveryOrderLedger:[{orderId:'1',shopSku:'A',units:1},{orderId:'1',shopSku:'B',units:1},{orderId:'2',shopSku:'A',units:2}]}]);
 assert.deepEqual(sadOrderReview(m,jobs,orders,realization),{orders:2,matched:1,unmatched:1,multiSku:1,skuIncomeVerified:false,netProfit:null});
 assert.equal(sadOrderReview(m,jobs,audit([{...orders.sheets[0],duplicateOrderIds:1}]),realization),null);
 assert.equal(sadOrderReview(m,{...jobs,jobs:[jobs.jobs[0],{...jobs.jobs[1],scope:'149106500'}]},orders,realization),null);
});
