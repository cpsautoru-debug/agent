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

test('validated historical WB cost lines unlock exact 291492.64 contribution but not final net profit',()=>{
 const costLines=Array.from({length:35},(_,i)=>({
  vendorCode:'sku_'+i,unitCostKopecks:10000,
  soldUnits:i===34?3:5,resalableReturnedUnits:i===0?5:i===1?1:0,
  netCostKopecks:(i===34?3:i===0?0:i===1?4:5)*10000
 }));
 const net=costLines.reduce((n,r)=>n+r.netCostKopecks,0);
 const c={...x,managementCost:{
  status:'management_cost_reconciled',
  profitStatus:'management_after_wb_charges_and_cogs',
  source:'WB_SAVED_XLSX_OWNER_CONFIRMED_UNIT_COSTS',scope:'2026-10',
  readOnly:true,changedRecords:0,
  confirmedSkuCount:35,confirmedSoldUnits:173,
  resalableReturnedUnits:6,snapshotReports:9,
  returnBasis:'OWNER_CONFIRMED_ALL_6_RESALABLE_2026_11_24',
  verifiedNetProfit:false,costLines,
  grossManufacturingCostKopecks:1730000,
  recoveredReturnCostKopecks:60000,
  netManufacturingCostKopecks:net,
  contributionKopecks:68571564-net
 }};
 const valid=validateDashboardWbMonth(c,'2026-10');
 assert.equal(valid.managementCost.netManufacturingCostKopecks,1670000);
 assert.equal(valid.managementCost.contributionKopecks,66901564);
 assert.equal(valid.managementCost.status,'known_cost_result');
 assert.equal(valid.netProfitKopecks,undefined);
 const broken=structuredClone(c);
 broken.managementCost.costLines[0].unitCostKopecks++;
 assert.equal(validateDashboardWbMonth(broken,'2026-10').managementCost,null);
});
