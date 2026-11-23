import test from 'node:test';
import assert from 'node:assert/strict';
import {describeDashboardWbEvidence} from '../../web/office/business-pnl-source-evidence.mjs';
const month='2026-10';
const base={code:'entity_income_evidence',month,readOnly:true,
 changedRecords:0,distributionReady:false,
 wb:{taxIncomeConfirmed:false,payoutIsNotTaxRevenue:true,reports:10,
 reportPeriodComplete:true,
 costCoverage:{soldArticles:35,confirmedArticles:0,
 preliminaryArticles:1,complete:false}}};
test('WB source evidence is shown as coverage rather than invented net profit',()=>{
 const msg=describeDashboardWbEvidence(base,month);
 assert.match(msg,/10/);
 assert.match(msg,/0 из 35/);
 assert.match(msg,/Выплаты не равны прибыли/);
});
test('WB source requires strict identity and accurate COGS evidence',()=>{
 assert.throws(()=>describeDashboardWbEvidence(base,'2026-11'));
 assert.throws(()=>describeDashboardWbEvidence({...base,changedRecords:1},month));
 assert.throws(()=>describeDashboardWbEvidence({...base,wb:{
  ...base.wb,costCoverage:{...base.wb.costCoverage,confirmedArticles:40}
 }},month));
});
