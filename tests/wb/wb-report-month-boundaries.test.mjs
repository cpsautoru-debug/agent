import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyWbReportMonth} from '../../web/office/wb-report-month-boundaries-core.mjs';
const row=(id,from,to,status='complete',sum=1000)=>({
 report_id:String(id),date_from:from,date_to:to,status,
 bank_payment_kop:sum,row_count:10
});
test('only full report-date intervals are included in the partial month subtotal',()=>{
 const d=classifyWbReportMonth([
   row(1,'2026-10-01','2026-10-07','complete',300),
   row(2,'2026-09-29','2026-10-05','complete',200),
   row(3,'2026-10-27','2026-11-03','complete',500),
   row(4,'2026-10-14','2026-10-20','pending',800),
   row(5,'2026-11-01','2026-11-07','complete',900)
 ],'2026-10');
 assert.equal(d.totalWhollyInsideKopecks,300);
 assert.equal(d.whollyInside.length,1);
 assert.equal(d.crossing.length,2);
 assert.equal(d.pending.length,1);
 assert.equal(d.calendarMonthComplete,false);
 assert.equal(d.bankStatementVerified,false);
 assert.equal(d.monthAttributionVerified,false);
 assert.equal(d.netProfitKopecks,null);
});
test('invalid identifiers, duplicate reports and malformed periods fail closed',()=>{
 assert.throws(()=>classifyWbReportMonth([row(1,'2026-10-01','2026-10-02'),
 row(1,'2026-10-02','2026-10-04')],'2026-10'),/invalid/);
 assert.throws(()=>classifyWbReportMonth([row(2,'2026-02-30','2026-03-02')],'2026-02'),/invalid/);
 assert.throws(()=>classifyWbReportMonth([row(2,'2026-11-01','2026-10-10')],'2026-10'),/invalid/);
});
test('UI and owner-only read endpoint have no writes or guessed P&L',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const api=readFileSync(new URL('../../functions/api/wb/report-month-boundaries.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../../web/office/wb-report-month-boundaries-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/id="wbMonthBoundaryMonth"/);
 assert.match(html,/wb-report-month-boundaries-ui\.mjs\?v=20261122/);
 assert.match(api,/verifySession/);
 assert.match(api,/office_authorized_users/);
 assert.match(api,/WB_REPORT_SNAPSHOT_DB/);
 assert.doesNotMatch(api,/\b(?:INSERT|UPDATE|DELETE|DROP)\b/);
 assert.doesNotMatch(ui,/method:'POST'|innerHTML|localStorage/);
});
