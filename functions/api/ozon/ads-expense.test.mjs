import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCanonicalOzonAdvertising} from './ads-expense.js';

const month='2026-10';
const api={coveredDays:31,totalKopecks:135307991};
function profit(ads=[-33728488]){
  return {report:{rows:2304,totalKopecks:135307991},
    advertisingAudit:{reportAdvertisingRows:ads.map((amountKopecks,i)=>
      ({date:i?'2026-10-02':'2026-10-01',service:'Оплата за клик',amountKopecks}))}};
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

test('Premium is classified separately and never subtracted again',()=>{
 const evidence=summarizeCanonicalOzonAdvertising(month,{
  report:{rows:2304,totalKopecks:135307991},
  advertisingAudit:{reportAdvertisingRows:[
   {date:'2026-10-01',service:'Продвижение с оплатой за заказ',amountKopecks:-29125223},
   {date:'2026-10-02',service:'Оплата за клик',amountKopecks:-3205265},
   {date:'2026-10-03',service:'Подписка Premium Plus',amountKopecks:-1398000}
  ]}
 },api);
 assert.equal(evidence.advertisingAccrualKopecks,-33728488);
 assert.equal(evidence.performanceComparableKopecks,-32330488);
 assert.equal(evidence.premiumKopecks,-1398000);
 assert.equal(evidence.comparableRows,2);
 assert.equal(evidence.premiumRows,1);
 assert.equal(evidence.otherRows,0);
 assert.equal(evidence.performanceSourceReconciled,false);
 assert.equal(evidence.deductedFromProfit,false);
});
