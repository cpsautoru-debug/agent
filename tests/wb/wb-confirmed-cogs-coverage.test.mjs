import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateWbSkuBreakdown}
  from '../../web/office/wb-unit-economics-core.mjs';
const group=(vendor,sold,from='2026-10-01',to='2026-10-07')=>({
 report_id:'123',vendor_code:vendor,date_from:from,date_to:to,
 status:'complete',operation_count:1,sold_units:sold,returned_units:0,
 product_payout_kop:1000,platform_fees_kop:0,
 additional_payment_kop:0,paid_acceptance_kop:0
});
const cost=(code,status='confirmed',to=null)=>({
 vendor_code:code,valid_from:'2026-10-01',valid_to:to,
 cost_kopecks:100,status,source:'Сверенная производственная карточка'
});
const stats={complete_reports:1,pending_reports:0,
 bank_payout_kop:3000,completed_operations:3};
test('preliminary cost never counts as confirmed manufacturing coverage',()=>{
 const result=calculateWbSkuBreakdown([
   group('confirmed',2),group('preliminary',3),group('missing',4)
 ],[cost('confirmed'),cost('preliminary','preliminary')],stats);
 assert.equal(result.confirmedCostSoldUnits,2);
 assert.equal(result.missingCostSoldUnits,4);
 assert.equal(result.preliminaryCostSoldUnits,3);
 assert.equal(result.unverifiedCostSoldUnits,7);
 assert.equal(result.totalKnownManufacturingCogsKopecks,500);
 assert.equal(result.netProfitKopecks,null);
 assert.equal(result.costEvidenceScope,'SOLD_UNITS_IN_COMPLETED_REPORTS_NOT_CALENDAR_MONTH');
 const preliminary=result.articles.find(x=>x.vendorCode==='preliminary');
 assert.equal(preliminary.unverifiedCostSoldUnits,3);
 assert.equal(preliminary.contributionAfterKnownCogsKopecks,null);
});
test('a conflicting cost validity period is explicitly unverified',()=>{
 const result=calculateWbSkuBreakdown([group('crossed',2)],
   [cost('crossed','confirmed','2026-10-03')],
   {...stats,bank_payout_kop:1000,completed_operations:1});
 assert.equal(result.versionConflictSoldUnits,2);
 assert.equal(result.unverifiedCostSoldUnits,2);
 assert.equal(result.missingCostSoldUnits,2);
 assert.equal(result.confirmedCostSoldUnits,0);
 assert.equal(result.netProfitKopecks,null);
});
test('WB UI differentiates absent price from non-confirmed prices',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../../web/office/wb-unit-economics.js',import.meta.url),'utf8');
 assert.match(html,/id="wbUnitUnverifiedCost"/);
 assert.match(html,/wb-unit-economics\.js\?v=20261122-cogs-coverage/);
 assert.match(ui,/data\.unverifiedCostSoldUnits/);
 assert.match(ui,/data\.preliminaryCostSoldUnits/);
 assert.match(ui,/data\.versionConflictSoldUnits/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage/);
});
