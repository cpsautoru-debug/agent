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
   report:{complete:true},
   sourcesMatch:{apiVsXlsxKopecks:true},
   dailyParity:{match:true,checkedDays:31,expectedDays:31}}
 };
}
test('Ozon known-cost result is shown only as provisional and does not allocate tax',()=>{
 const r=summarizeOzonProvisionalProfit(month,evidence());
 assert.equal(r.status,'provisional_known_cost_result');
 assert.equal(r.financeNetKopecks,135307991);
 assert.equal(r.netManufacturingCostKopecks,80471000);
 assert.equal(r.beforeAllocationKopecks,54836991);
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
