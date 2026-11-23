import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCanonicalOzonAdvertising} from './ads-expense.js';

const month='2026-10';
const api={coveredDays:31,totalKopecks:135307991};
function profit(ads=[-33728488]){
  return {report:{rows:2304,totalKopecks:135307991},
    advertisingAudit:{reportAdvertisingRows:ads.map((amountKopecks,i)=>
      ({date:i?'2026-10-02':'2026-10-01',amountKopecks}))}};
}
test('canonical XLSX advertising is independent of raw Performance moneySpent',()=>{
  const f=summarizeCanonicalOzonAdvertising(month,profit(),api);
  assert.equal(f.source,'CANONICAL_OZON_FINANCE_XLSX');
  assert.equal(f.advertisingAccrualKopecks,-33728488);
  assert.equal(f.sourceTotalsMatched,true);
  assert.equal(f.matchedToPerformance,false);
  assert.equal(f.deductedFromProfit,false);
  assert.equal(f.reconciled,false);
});
test('reconciliation is not asserted even with a matching month total',()=>{
  const f=summarizeCanonicalOzonAdvertising(month,profit([-100,-200]),api);
  assert.equal(f.advertisingRows,2);
  assert.equal(f.advertisingAccrualKopecks,-300);
  assert.equal(f.reconciled,false);
});
test('canonical API total mismatch is explicit and not silently repaired',()=>{
  const f=summarizeCanonicalOzonAdvertising(month,profit(),
    {...api,totalKopecks:135307990});
  assert.equal(f.sourceTotalsMatched,false);
});
test('invalid money and missing report are rejected rather than assumed zero',()=>{
  assert.throws(()=>summarizeCanonicalOzonAdvertising(month,{
    report:null,advertisingAudit:{reportAdvertisingRows:[]}
  },api),/invalid_canonical_advertising_rows/);
  assert.throws(()=>summarizeCanonicalOzonAdvertising(month,profit([NaN]),api),
    /invalid_canonical_advertising_rows/);
});
