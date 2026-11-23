import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOzonDailyTotals} from './daily-parity.js';
const days=Array.from({length:31},(_,i)=>({
 date:'2026-10-'+String(i+1).padStart(2,'0'),
 complete:true,totalKopecks:i===0?135307991:0
}));
test('October daily API/XLSX totals all match without claiming detail reconciliation',()=>{
 const x=compareOzonDailyTotals('2026-10',[
  {date:'2026-10-01',amountKopecks:135307991}
 ],days);
 assert.equal(x.checkedDays,31);
 assert.equal(x.matchedDays,31);
 assert.equal(x.match,true);
 assert.equal(x.officialDetailReconciled,false);
 assert.equal(x.changedRecords,0);
});
test('one missing API day prevents green status even if monthly total matches',()=>{
 const x=compareOzonDailyTotals('2026-10',[
  {date:'2026-10-01',amountKopecks:135307991}
 ],days.slice(0,30));
 assert.equal(x.match,false);
 assert.equal(x.matchedDays,30);
 assert.equal(x.discrepancies.length,1);
});
test('one kopeck daily discrepancy is reported and not rounded away',()=>{
 const x=compareOzonDailyTotals('2026-10',[
  {date:'2026-10-01',amountKopecks:135307990},
  {date:'2026-10-02',amountKopecks:1}
 ],days);
 assert.equal(x.match,false);
 assert.equal(x.matchedDays,29);
 assert.deepEqual(x.discrepancies.map(d=>d.differenceKop),[-1,1]);
});
test('duplicate day or unverified pagination fails closed',()=>{
 assert.throws(()=>compareOzonDailyTotals('2026-10',[],[
  days[0],days[0]
 ]),/invalid_daily_api_row/);
 assert.throws(()=>compareOzonDailyTotals('2026-10',[],[
  {...days[0],complete:false}
 ]),/invalid_daily_api_row/);
});
