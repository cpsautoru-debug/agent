import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWbSkuBreakdown,validateUnitCost,findCostForReport,
  finalProfitGate
} from '../../web/office/wb-unit-economics-core.mjs';
const group=(id,vendor,payout,fees,sold,returned=0,adjust=0)=>({
  report_id:String(id),vendor_code:vendor,
  date_from:'2026-10-01',date_to:'2026-10-07',status:'complete',
  operation_count:1,sold_units:sold,returned_units:returned,
  product_payout_kop:payout,platform_fees_kop:fees,
  additional_payment_kop:adjust,paid_acceptance_kop:0
});
const costs=[
  {vendor_code:'VESTA-1',valid_from:'2026-09-01',valid_to:null,
    cost_kopecks:36000,status:'confirmed',source:'Материал + швея + раскройщик'},
  {vendor_code:'DOOR-1',valid_from:'2026-10-01',valid_to:null,
    cost_kopecks:12000,status:'confirmed',source:'Техкарта дверной вставки'}
];
const sample=[
  group('1001','VESTA-1',50000,2000,2),
  group('1001','DOOR-1',30000,1000,1),
  group('1001',null,0,5000,0)
];
const stats={
  complete_reports:1,pending_reports:1,
  bank_payout_kop:72000,completed_operations:3
};
test('completed WB reports reconcile payout and separate unallocated fees',()=>{
  const result=calculateWbSkuBreakdown(sample,costs,stats);
  assert.equal(result.bankPayoutKopecks,72000);
  assert.equal(result.reconciliation,'matched');
  assert.equal(result.completedOperations,3);
  assert.equal(result.completeReports,1);
  assert.equal(result.pendingReports,1);
  assert.equal(result.skuCount,2);
  assert.equal(result.unassignedFeesKopecks,5000);
  assert.equal(result.unassignedPayoutKopecks,-5000);
  assert.equal(result.totalKnownManufacturingCogsKopecks,84000);
  assert.equal(result.confirmedCostSoldUnits,3);
  assert.equal(result.missingCostSoldUnits,0);
  const vest=result.articles.find(x=>x.vendorCode==='VESTA-1');
  assert.equal(vest.soldUnits,2);
  assert.equal(vest.payoutKopecks,48000);
  assert.equal(vest.knownManufacturingCogsKopecks,72000);
  assert.equal(vest.contributionAfterKnownCogsKopecks,-24000);
  assert.equal(vest.netProfitKopecks,null);
  assert.equal(result.netProfitKopecks,null);
  for(const missing of ['advertising_missing','tax_register_missing',
    'shared_overheads_missing','unattributed_platform_charges',
    'calendar_period_not_verified','reports_pending'])
    assert.ok(result.blockers.includes(missing),missing);
});
test('missing or preliminary unit cost cannot be silently treated as zero profit',()=>{
  const missing=calculateWbSkuBreakdown(sample,[],stats);
  assert.equal(missing.totalKnownManufacturingCogsKopecks,0);
  assert.equal(missing.missingCostSoldUnits,3);
  assert.ok(missing.articles.every(x=>x.contributionAfterKnownCogsKopecks===null));
  const preliminary=calculateWbSkuBreakdown([sample[0]],
    [{...costs[0],status:'preliminary'}],
    {complete_reports:1,pending_reports:0,bank_payout_kop:48000,
      completed_operations:1});
  assert.equal(preliminary.confirmedCostSoldUnits,0);
  assert.equal(preliminary.missingCostSoldUnits,0);
  assert.equal(preliminary.articles[0].contributionAfterKnownCogsKopecks,null);
  assert.ok(preliminary.articles[0].blockers.includes('cost_preliminary'));
});
test('return condition and cost changes inside weekly report block exact contribution',()=>{
  const returned=calculateWbSkuBreakdown([group('12','VESTA-1',48000,0,1,1)],
    costs,{complete_reports:1,pending_reports:0,bank_payout_kop:48000,
      completed_operations:1});
  assert.equal(returned.articles[0].returnedUnits,1);
  assert.equal(returned.articles[0].contributionAfterKnownCogsKopecks,null);
  assert.ok(returned.blockers.includes('return_condition_unverified'));
  assert.ok(returned.blockers.includes('return_conditions_missing'));
  const changed=[costs[0],{
    ...costs[0],valid_from:'2026-10-05',cost_kopecks:38000
  }];
  const cross=calculateWbSkuBreakdown([sample[0]],changed,{
    complete_reports:1,pending_reports:0,bank_payout_kop:48000,
    completed_operations:1
  });
  assert.equal(cross.articles[0].contributionAfterKnownCogsKopecks,null);
  assert.ok(cross.articles[0].blockers.includes('cost_version_crosses_report_period'));
});
test('malformed source, payout mismatch, missing rows and overflow fail closed',()=>{
  assert.throws(()=>calculateWbSkuBreakdown(sample,costs,
    {...stats,bank_payout_kop:72001}),/reconciliation_failed/);
  assert.throws(()=>calculateWbSkuBreakdown(sample,costs,
    {...stats,completed_operations:4}),/operation_coverage_invalid/);
  assert.throws(()=>calculateWbSkuBreakdown([
    {...sample[0],product_payout_kop:Number.MAX_SAFE_INTEGER},
    {...sample[1],product_payout_kop:Number.MAX_SAFE_INTEGER}
  ],costs,stats));
  assert.throws(()=>calculateWbSkuBreakdown([
    {...sample[0],vendor_code:'bad\ncode'}
  ],costs,{...stats,completed_operations:1,bank_payout_kop:48000}));
  assert.throws(()=>validateUnitCost({...costs[0],cost_kopecks:0}));
  assert.throws(()=>validateUnitCost({...costs[0],source:'private\n'}));
  assert.throws(()=>calculateWbSkuBreakdown(sample,[costs[0],costs[0]],stats),
    /duplicate/);
});
test('final profit gate requires explicit ads, taxes, overhead and complete sources',()=>{
  const incomplete=finalProfitGate({
    contributionKopecks:200000,advertisingKopecks:null,taxKopecks:10000,
    allocatedOverheadsKopecks:20000,allSourcesComplete:false
  });
  assert.deepEqual(incomplete,{netProfitKopecks:null,status:'unverified'});
  assert.deepEqual(finalProfitGate({
    contributionKopecks:200000,advertisingKopecks:30000,taxKopecks:10000,
    allocatedOverheadsKopecks:20000,allSourcesComplete:true
  }),{netProfitKopecks:140000,status:'verified'});
  assert.throws(()=>findCostForReport([], 'A','2026-15-51','2026-15-56'));
});

test('paid acceptance is included once for coded and unassigned operations',()=>{
 const rows=[{...sample[0],paid_acceptance_kop:7000},{...sample[1]},{...sample[2],paid_acceptance_kop:5000}];
 const s={...stats,bank_payout_kop:60000};
 const r=calculateWbSkuBreakdown(rows,costs,s);
 const a=r.articles.find(x=>x.vendorCode==='VESTA-1');
 assert.equal(a.platformFeesKopecks,9000);
 assert.equal(a.payoutKopecks,41000);
 assert.equal(a.contributionAfterKnownCogsKopecks,-31000);
 assert.equal(r.unassignedFeesKopecks,10000);
 assert.equal(r.unassignedPayoutKopecks,-10000);
 assert.equal(r.articles.reduce((n,x)=>n+x.payoutKopecks,0)+r.unassignedPayoutKopecks,60000);
 assert.equal(r.unreconciledAdditionalFieldsKopecks,0);
 assert.equal(r.netProfitKopecks,null);
 assert.throws(()=>calculateWbSkuBreakdown(rows,costs,stats),/reconciliation_failed/);
 const additional=calculateWbSkuBreakdown([{...rows[0],additional_payment_kop:1},...rows.slice(1)],costs,s);
 assert.ok(additional.blockers.includes('additional_payment_fields_not_reconciled'));
});
