import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessFinanceCloseout} from '../../web/office/finance-closeout-core.mjs';
const fixture=()=>({
  code:'unified_finance_source_audit',readOnly:true,netProfitKopecks:null,
  wb:{status:'ready',count:4,confirmed:3},
  ozonProfit:{status:'ready',count:4,confirmed:4},
  ozonCatalog:{count:3,confirmed:3},
  skuCoverage:{profitOnlySkuCount:2,catalogOnlySkuCount:1},
  expenses:{status:'ready',configuredCount:2},
  blockers:['wb_ozon_link_not_confirmed','material_delivery_possible_double_count']
});
test('no P&L approval without payout / taxes / advertising reconciliation',()=>{
  const result=assessFinanceCloseout(fixture());
  assert.equal(result.canCloseWb,false);
  assert.equal(result.canCloseOzon,false);
  assert.equal(result.readOnly,true);
  assert.match(result.wbReasons.join(' '),/неподтверждённые версии себестоимости WB/);
  assert.match(result.ozonReasons.join(' '),/SKU из Ozon Profit/);
  assert.match(result.ozonReasons.join(' '),/двойной учёт/);
  assert.ok(!result.wbReasons.join(' ').includes('WB-to-Ozon'));
});
test('even fully confirmed source catalogs do not prove real-world cash and taxes',()=>{
  const data=fixture();
  data.wb.confirmed=4;
  data.ozonProfit.count=3;data.ozonProfit.confirmed=3;
  data.skuCoverage.profitOnlySkuCount=0;
  data.skuCoverage.catalogOnlySkuCount=0;
  data.blockers=[];
  const result=assessFinanceCloseout(data);
  assert.equal(result.canCloseWb,false);
  assert.equal(result.canCloseOzon,false);
  assert.match(result.wbReasons.join(' '),/выплаты/);
});
test('invalid audit payload never permits financial sign-off',()=>{
  assert.throws(()=>assessFinanceCloseout({}),/invalid/);
  assert.throws(()=>assessFinanceCloseout({...fixture(),netProfitKopecks:0}),/invalid/);
});
test('read-only closeout view is wired into the staging office',()=>{
  const js=readFileSync(new URL('../../web/office/finance-cost-audit.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  assert.match(js,/assessFinanceCloseout\(data\)/);
  assert.match(html,/finance-cost-audit\.mjs\?v=20261122-closeout-gates/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML/);
});
