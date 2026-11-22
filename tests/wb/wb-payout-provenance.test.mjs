import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {explainWbPayoutEvidence} from '../../web/office/wb-payout-provenance-core.mjs';
const fixture=()=>({
 code:'wb_unit_economics_preview',source:'WB_FINANCE_API_D1',
 scope:'ALL_COMPLETED_WB_REPORTS_NOT_CALENDAR_MONTH',
 readOnly:true,changedRecords:0,profitVerified:false,netProfitKopecks:null,
 completeReports:3,pendingReports:1,mismatchedReports:1,bankPayoutKopecks:100000,
 completedOperations:18,reconciliation:'matched'
});
test('internal WB payout matching is explicitly not a verified bank settlement',()=>{
 const state=explainWbPayoutEvidence(fixture());
 assert.equal(state.reportedPayoutKopecks,100000);
 assert.equal(state.bankStatementVerified,false);
 assert.equal(state.calendarMonthVerified,false);
 assert.equal(state.reportCount,3);
 assert.equal(state.mismatchedCount,1);
 assert.match(state.note,/исключены из этой суммы/);
 assert.match(state.note,/не банковская выписка/);
});
test('malformed, unverified or period-mismatched results fail closed',()=>{
 for(const changes of [
  {netProfitKopecks:0},{profitVerified:true},
  {scope:'CALENDAR_MONTH'},{reconciliation:'not_matched'},
  {completedOperations:-1},{readOnly:false}
 ])assert.throws(()=>explainWbPayoutEvidence({...fixture(),...changes}),/invalid/);
});
test('site includes independent read-only evidence panel',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/wb-payout-provenance-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/id="financeWbPayoutEvidenceStatus"/);
 assert.match(html,/wb-payout-provenance-ui\.mjs\?v=20261122/);
 assert.match(js,/\/api\/wb\/unit-economics/);
 assert.doesNotMatch(js,/method:'POST'|localStorage|innerHTML/);
});
