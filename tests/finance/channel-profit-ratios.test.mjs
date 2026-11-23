import test from 'node:test';
import assert from 'node:assert/strict';
import {financeRateBps,displayRate,previousMonth,comparativeFinance} from
 '../../web/office/channel-finance-metrics.mjs';
import {wbMonthManagementMetrics} from '../../web/office/wb-management-profit.mjs';
import {ozonManagementMetrics} from '../../web/office/ozon-management-metrics.mjs';
import {makeOzonCards} from '../../web/office/profit-cards-core.js';
const total=135307991,known=80471000;
const groups=[['Продажи',408967600],['Возвраты',-29917700],
 ['Вознаграждение Ozon',-176828607],
 ['Услуги доставки',-15289700],['Продвижение и реклама',-33728488],
 ['Услуги партнёров',-4439510],['Услуги FBO',-378840],
 ['Озон Технологии',-5600000],
 ['Другие услуги и штрафы',-7476764]].map(([name,amountKopecks])=>({name,amountKopecks}));
const result={month:'2026-10',api:{totalKopecks:total},
 report:{totalKopecks:total,salesKopecks:408967600,
  returnsKopecks:-29917700,groups,quantityVerified:true,periodVerified:true},
 costs:{complete:true,knownKopecks:known},
 dateCostEvidence:{complete:true,checkedSalesRows:227,confirmedSalesRows:227},
 profit:{blockers:['duplicate_candidates','api_unverified_or_incomplete',
  'allocation_missing','tax_register_missing']}};
const readiness={code:'ozon_finance_readiness',month:'2026-10',
 sourcesMatch:{apiVsXlsxKopecks:true},
 dailyParity:{code:'ozon_daily_totals_parity',readOnly:true,
  changedRecords:0,match:true,checkedDays:31,expectedDays:31},
 report:{complete:true,controlTotalKop:total},
 cogs:{complete:true,checkedSalesRows:227,confirmedSalesRows:227}};
test('Ozon October gross and direct-cost margin ratios use net accrual basis',()=>{
 const r=ozonManagementMetrics(result,readiness,makeOzonCards);
 assert.equal(r.basisKopecks,379049900);
 assert.equal(r.grossKopecks,298578900);
 assert.equal(r.contributionKopecks,54836991);
 assert.equal(r.grossRateBps,7877);
 assert.equal(r.contributionRateBps,1447);
 assert.equal(displayRate(r.contributionRateBps),'14,47%');
});
test('cannot form Ozon ratio from unmatched amounts',()=>{
 const bad={...readiness,dailyParity:{...readiness.dailyParity,match:false}};
 assert.equal(ozonManagementMetrics(result,bad,makeOzonCards),null);
});
const wb={code:'wb_month_settlement',month:'2026-10',
 source:'WB_FINANCE_API_D1',readOnly:true,changedRecords:0,
 reportPeriodCovered:true,settlementReconciled:true,profitVerified:false,
 manufacturingCostKopecks:null,contributionKopecks:null,netProfitKopecks:null,
 reports:10,rows:1020,soldArticles:35,confirmedCostArticles:0,
 preliminaryCostArticles:1,expectedDays:31,
 productPayoutKopecks:90221081,returnsKopecks:4885753,
 platformFeesKopecks:16763764,deliveryKopecks:7324344,
 storageKopecks:106738,deductionsKopecks:7906700,
 penaltyKopecks:1425982,afterWbChargesKopecks:68571564};
test('WB detailed report preserves after-deduction amount and keeps profits null',()=>{
 const m=wbMonthManagementMetrics(wb,'2026-10');
 assert.equal(m.amountKopecks,68571564);
 assert.equal(m.basisKopecks,85335328);
 assert.equal(m.profitKopecks,null);
 assert.equal(m.afterChargesRateBps,8036);
 assert.equal(m.breakdown.reduce((a,[,v])=>a+v,0),68571564);
});
test('comparisons require both periods with actual amounts',()=>{
 assert.equal(previousMonth('2026-01'),'2025-12');
 assert.deepEqual(comparativeFinance(100,null),{
  status:'insufficient_data',absoluteKopecks:null,changeBps:null});
 assert.equal(comparativeFinance(200,100).absoluteKopecks,100);
 assert.equal(financeRateBps(5,0),null);
 assert.throws(()=>previousMonth('2026-13'));
 assert.throws(()=>wbMonthManagementMetrics({...wb,profitVerified:true},'2026-10'));
});
