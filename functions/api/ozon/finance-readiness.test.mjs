import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzonFinanceReadiness,summarizeOzonFinanceReadiness}
  from './finance-readiness.js';

const baseData={
 target:'ce9dd331-929d-4c3e-9073-368de3346bc9',
 configuration:{costs:{entries:Array.from({length:36},(_,i)=>({
   sku:String(i+1),validFrom:'2026-10-01',
   costKopecks:420000,status:'confirmed'
 }))}}
};
const baseResult={
 month:'2026-10',
 api:{coveredDays:31,days:31,records:968,totalKopecks:135307991,
   netVerified:false,detailVerified:false},
 report:{rows:2304,periodVerified:true,quantityVerified:true,
   totalKopecks:135307991},
 dateCostEvidence:{checkedSalesRows:227,confirmedSalesRows:227,
   complete:true},
 skuRows:Array.from({length:36},(_,i)=>({
   sku:String(i+1),costStatus:'confirmed'
 })),
 financeCloseout:{missing:['advertisingSourceReconciled',
   'taxRegisterAudited','bankStatementReconciled']},
 profit:{blockers:['api_unverified_or_incomplete',
   'allocation_missing']}
};
test('canonical October API and XLSX match to kopeck; net profit stays unverified',()=>{
 const s=summarizeOzonFinanceReadiness('2026-10',baseData,baseResult);
 assert.equal(s.source,'CANONICAL_OZON_FINANCE_SYNC');
 assert.equal(s.accruals.coveredDays,31);
 assert.equal(s.accruals.rows,968);
 assert.equal(s.report.records,2304);
 assert.equal(s.cogs.confirmedEntries,36);
 assert.equal(s.cogs.confirmedSalesRows,227);
 assert.equal(s.sourcesMatch.apiVsXlsxKopecks,true);
 assert.equal(s.sourcesMatch.differenceKop,0);
 assert.ok(s.blockers.includes('api_net_unverified'));
 assert.ok(s.blockers.includes('api_details_unverified'));
 assert.equal(s.netProfitVerified,false);
 assert.equal(s.changedRecords,0);
});
test('canonical report mismatch cannot be shown as reconciled',()=>{
 const s=summarizeOzonFinanceReadiness('2026-10',baseData,{
   ...baseResult,report:{...baseResult.report,totalKopecks:135307990}
 });
 assert.equal(s.sourcesMatch.apiVsXlsxKopecks,false);
 assert.equal(s.sourcesMatch.differenceKop,-1);
 assert.ok(s.blockers.includes('report_api_aggregate_unverified'));
});
test('wrong canonical database target rejected',()=>{
 assert.throws(()=>summarizeOzonFinanceReadiness('2026-10',
   {...baseData,target:'legacy-db'},baseResult),
 /invalid_canonical_finance_data/);
});
test('missing date-effective COGS remains partial without invented values',()=>{
 const s=summarizeOzonFinanceReadiness('2026-10',
   {...baseData,configuration:{costs:{entries:[]}}},
   {...baseResult,
     dateCostEvidence:{checkedSalesRows:227,confirmedSalesRows:0,
       complete:false},
     skuRows:[{sku:'24086',article:'24086',costStatus:'missing'}]
   });
 assert.equal(s.cogs.confirmedEntries,0);
 assert.equal(s.cogs.confirmedSalesRows,0);
 assert.equal(s.missingCostProducts[0].autoAssignment,false);
});
test('endpoint refuses writes and future months before accessing data',async()=>{
 const handler=createOzonFinanceReadiness();
 for(const req of [
   new Request('https://example.com/api/ozon/finance-readiness?month=2026-10',{method:'POST'}),
   new Request('https://example.com/api/ozon/finance-readiness?month=2026-13'),
   new Request('https://example.com/api/ozon/finance-readiness?month=2026-12')
 ]){
   const r=await handler({request:req,env:{}});
   assert.ok([400,405].includes(r.status));
 }
});
test('owner authentication is required',async()=>{
 const handler=createOzonFinanceReadiness();
 const r=await handler({request:new Request(
   'https://example.com/api/ozon/finance-readiness?month=2026-10'),env:{}});
 assert.equal(r.status,503);
});
