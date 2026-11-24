import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretYandexCostSnapshot,loadYandexCostSnapshot}
 from '../../web/office/yandex-snapshot-dashboard.mjs';
const month='2026-10';
const data=()=>({
 code:'yandex_month_evidence_available',readOnly:true,month,
 sourceKind:'owner_browser_audited_summary',
 evidence:{ownerEntity:'ИП Жилина Ольга',
  status:'preliminary_contribution_ready',
  orderAfterServiceKopecks:61779235,
  deliveredCostKopecks:32000000,
  preliminaryContributionKopecks:29779235,
  netProfitKopecks:null,issues:[],
  skus:[{shopSku:'abc',deliveredUnits:1,costKopecks:320000,
   costStatus:'matched_owner'}]}
});
test('verified SKU snapshot provides only an interim contribution',()=>{
 const result=interpretYandexCostSnapshot(month,data());
 assert.equal(result.status,'preliminary_cost_reconciled');
 assert.equal(result.preliminaryContributionKopecks,29779235);
 assert.equal(result.netProfitKopecks,null);
});
test('partial SKU coverage is explicit and cannot pretend to be net profit',()=>{
 const d=data();d.evidence.status='partial';
 d.evidence.skus.push({shopSku:'missing',deliveredUnits:2,
  costKopecks:null,costStatus:'missing'});
 const result=interpretYandexCostSnapshot(month,d);
 assert.equal(result.status,'incomplete_cost_coverage');
 assert.equal(result.missingCount,1);
 assert.equal(result.preliminaryContributionKopecks,null);
});
test('stale, fake or another owner snapshot never displays monetary contribution',()=>{
 for(const d of [
  {...data(),month:'2026-09'},
  {...data(),code:'yandex_month_evidence_stale'},
  {...data(),readOnly:false},
  {...data(),evidence:{...data().evidence,ownerEntity:'ООО'}},
  {...data(),evidence:{...data().evidence,netProfitKopecks:1}},
  {...data(),evidence:{...data().evidence,deliveredCostKopecks:1}}
 ]){
  const result=interpretYandexCostSnapshot(month,d);
  assert.equal(result.status,'unavailable');
  assert.equal(result.preliminaryContributionKopecks,null);
 }
});
test('reads owner API without writing; reports absence as unavailable',async()=>{
 const a=await loadYandexCostSnapshot(month,async(path,opts)=>{
  assert.equal(path,'/api/yandex/evidence-snapshot?month=2026-10');
  assert.equal(opts.method,'GET');
  assert.equal(opts.credentials,'same-origin');
  return {ok:true,json:async()=>data()};
 });
 assert.equal(a.status,'preliminary_cost_reconciled');
 const b=await loadYandexCostSnapshot(month,async()=>({ok:false}));
 assert.equal(b.status,'unavailable');
 assert.equal(b.netProfitKopecks,null);
});
