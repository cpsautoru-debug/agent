import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeOzonProvisionalProfit,describeOzonProvisionalProfit}
 from '../../web/office/ozon-provisional-profit.mjs';
const month='2026-10';
function evidence(){
 return {
  result:{
   month,api:{totalKopecks:135307991},
   costs:{knownKopecks:80471000,complete:true},
   dateCostEvidence:{complete:true,checkedSalesRows:227,confirmedSalesRows:227},
   financeCloseout:{status:'not_verified',netProfitVerified:false},
   profit:{blockers:['api_unverified_or_incomplete','allocation_missing']}
  },
  readiness:{month,netProfitVerified:false,
   report:{complete:true,controlTotalKop:135307991},
   accruals:{totalKop:135307991},
   cogs:{complete:true,checkedSalesRows:227,confirmedSalesRows:227},
   sourcesMatch:{apiVsXlsxKopecks:true},
   dailyParity:{code:'ozon_daily_totals_parity',match:true,
    readOnly:true,changedRecords:0,checkedDays:31,expectedDays:31}}
 };
}
test('Ozon known-cost result is shown only as provisional and does not allocate tax',()=>{
 const r=summarizeOzonProvisionalProfit(month,evidence());
 assert.equal(r.status,'provisional_known_cost_result');
 assert.equal(r.financeNetKopecks,135307991);
 assert.equal(r.netManufacturingCostKopecks,80471000);
 assert.equal(r.beforeAllocationKopecks,54836991);
 assert.deepEqual(r.missingEvidence,[]);
 assert.equal(r.netProfitKopecks,null);
 assert.equal(r.ownerTaxTotalKopecks,20550700);
 assert.equal(r.businessOverheadTotalKopecks,5400000);
 assert.equal(r.ozonTaxAllocationKopecks,null);
 assert.equal(r.verifiedNetProfit,false);
 assert.match(describeOzonProvisionalProfit(r),/НЕ РАССЧИТАНА/);
});
test('daily parity or dated COGS failures hide the provisional amount',()=>{
 for(const change of [
  x=>{x.readiness.dailyParity.match=false;},
  x=>{x.readiness.sourcesMatch.apiVsXlsxKopecks=false;},
  x=>{x.result.dateCostEvidence.confirmedSalesRows=226;},
  x=>{x.result.costs.complete=false;},
  x=>{x.result.profit.blockers.push('return_recovery_unverified');}
 ]){
  const x=evidence();change(x);
  const s=summarizeOzonProvisionalProfit(month,x);
  assert.equal(s.status,'insufficient_evidence');
  assert.equal(s.beforeAllocationKopecks,null);
 }
});
test('confirmed-net source signals or wrong month are refused',()=>{
 const x=evidence();x.readiness.netProfitVerified=true;
 assert.throws(()=>summarizeOzonProvisionalProfit(month,x),/invalid_profit_source/);
 assert.throws(()=>summarizeOzonProvisionalProfit('2026-11',evidence()),/invalid_profit_source/);
});
test('provisional calculation is displayed without mutation or persistence',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/ozon-provisional-profit.mjs',import.meta.url),'utf8');
 assert.match(html,/id="profitProvisionalStatus"/);
 assert.match(html,/id="profitProvisionalRefresh"/);
 assert.match(html,/ozon-provisional-profit.mjs/);
 assert.doesNotMatch(js,/localStorage|method:'POST'|innerHTML/);
});

test('accountant closeout fields do not suppress safe known-cost result',()=>{
 const x=evidence();
 x.result.financeCloseout.status='different_closeout_status';
 x.result.financeCloseout.netProfitVerified=false;
 const s=summarizeOzonProvisionalProfit(month,x);
 assert.equal(s.status,'provisional_known_cost_result');
 assert.equal(s.beforeAllocationKopecks,54836991);
});
test('different report total is explicitly blocked without a guessed amount',()=>{
 const x=evidence();x.readiness.report.controlTotalKop=135307990;
 const s=summarizeOzonProvisionalProfit(month,x);
 assert.equal(s.beforeAllocationKopecks,null);
 assert.ok(s.missingEvidence.includes('source_net_amount_not_confirmed'));
});

test('identical service fee rows are review warnings, not missing manufacturing cost',()=>{
 const x=evidence();
 x.result.profit.blockers.push('duplicate_candidates');
 x.result.duplicateCandidates=[[901,902],[1001,1002]];
 x.configuration={month:{rows:[
  {row:901,service:'Логистика'},{row:902,service:'Логистика'},
  {row:1001,service:'Вознаграждение за продажу'},
  {row:1002,service:'Вознаграждение за продажу'}
 ]}};
 const s=summarizeOzonProvisionalProfit(month,x);
 assert.equal(s.status,'provisional_known_cost_result');
 assert.equal(s.beforeAllocationKopecks,54836991);
 assert.deepEqual(s.reviewWarnings,
   ['identical_non_sale_fee_rows_require_detail_review']);
 assert.equal(s.verifiedNetProfit,false);
});
test('duplicate sale or return source rows block intermediate result',()=>{
 for(const service of ['Выручка','Возврат выручки']){
  const x=evidence();
  x.result.profit.blockers.push('duplicate_candidates');
  x.result.duplicateCandidates=[[901,902]];
  x.configuration={month:{rows:[
   {row:901,service},{row:902,service}
  ]}};
  const s=summarizeOzonProvisionalProfit(month,x);
  assert.equal(s.status,'insufficient_evidence');
  assert.equal(s.beforeAllocationKopecks,null);
  assert.match(s.missingEvidence.join(','),/duplicate_candidates/);
 }
});
test('unmapped charge duplicates block instead of being silently excused',()=>{
 const x=evidence();
 x.result.profit.blockers.push('duplicate_candidates');
 x.result.duplicateCandidates=[[901,902]];
 const s=summarizeOzonProvisionalProfit(month,x);
 assert.equal(s.status,'insufficient_evidence');
});
