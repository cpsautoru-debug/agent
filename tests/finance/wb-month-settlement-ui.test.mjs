import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDashboardWbMonth} from '../../web/office/wb-month-settlement-ui.mjs';
const x={code:'wb_month_settlement',month:'2026-10',
 source:'WB_FINANCE_API_D1',readOnly:true,changedRecords:0,
 reportPeriodCovered:true,settlementReconciled:true,profitVerified:false,
 manufacturingCostKopecks:null,contributionKopecks:null,netProfitKopecks:null,
 reports:10,rows:1020,soldArticles:35,confirmedCostArticles:0,
 preliminaryCostArticles:1,expectedDays:31,
 productPayoutKopecks:90221081,returnsKopecks:4885753,
 platformFeesKopecks:16763764,deliveryKopecks:7324344,
 storageKopecks:106738,deductionsKopecks:7906700,
 penaltyKopecks:1425982,afterWbChargesKopecks:68571564};
test('dashboard shows genuine WB interim amount but never treats it as profit',()=>{
 const s=validateDashboardWbMonth(x,'2026-10');
 assert.equal(s.amountKopecks,68571564);
 assert.equal(s.confirmedCostArticles,0);
 assert.match(s.label,/НЕ ПРИБЫЛЬ/);
 assert.equal(s.breakdown.reduce((n,[,a])=>n+a,0),68571564);
});
test('reject false settled amounts, false profit or incomplete monthly coverage',()=>{
 for(const change of [
  a=>{a.settlementReconciled=false;},
  a=>{a.afterWbChargesKopecks++;},
  a=>{a.netProfitKopecks=1;},
  a=>{a.manufacturingCostKopecks=0;},
  a=>{a.reportPeriodCovered=false;},
  a=>{a.month='2026-11';}
 ]){
  const a={...x};change(a);
  assert.throws(()=>validateDashboardWbMonth(a,'2026-10'));
 }
});
test('CEO P&L module reads dedicated month endpoint and labels it as interim',()=>{
 const js=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(js,/api\/wb\/month-settlement/);
 assert.match(js,/Расчёты после удержаний WB · до себестоимости/);
 assert.match(js,/Прибыль WB пока не рассчитана/);
});
