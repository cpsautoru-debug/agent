import test from 'node:test';
import assert from 'node:assert/strict';
import {auditUnifiedCostSources} from '../../web/office/unified-cost-audit-core.mjs';
const wb=[{
  vendor_code:'веста №2',valid_from:'2026-08-30',valid_to:null,
  cost_kopecks:420000,status:'preliminary',
  source:'Внутренний расчёт Vesta'
}];
const ozonCatalog=[{
  sku:'OZON-001',seller_article:'веста №2',model:'Lada Vesta',
  cost_kopecks:420000,status:'confirmed',source:'Подтверждённые нормы Vesta'
},{
  sku:'OZON-002',seller_article:'iskra-or',model:'Lada Iskra',
  cost_kopecks:469700,status:'confirmed',source:'Внутренние нормы Iskra'
}];
const profit={entries:[{
  sku:'OZON-001',validFrom:'2026-08-01',validTo:null,
  costKopecks:430000,status:'confirmed',source:'Ozon Profit',
  leatherDeliveryIncluded:null
}]};
const expenses={items:[{
  id:'rent',label:'Аренда помещения',
  amountKopecks:5000000,scope:'business',
  validFrom:'2026-11-01',validTo:null,leatherDelivery:false
},{
  id:'packing',label:'Упаковщик',
  amountKopecks:7000000,scope:'ozon',
  validFrom:'2026-11-01',validTo:null,leatherDelivery:false
}],allocation:{method:'unallocated',shares:null,revenue:null,source:''}};
const input={
  month:'2026-11',wbRows:wb,ozonCatalogRows:ozonCatalog,
  ozonProfitDocument:profit,ozonExpensesDocument:expenses,
  profitVersion:4,expenseVersion:3
};
test('reconcile real WB preliminary COGS, auxiliary Ozon prices and Profit versions separately',()=>{
  const r=auditUnifiedCostSources(input);
  assert.equal(r.code,'unified_finance_source_audit');
  assert.equal(r.readOnly,true);
  assert.equal(r.changedRecords,0);
  assert.equal(r.wb.count,1);
  assert.equal(r.wb.preliminary,1);
  assert.equal(r.wb.confirmed,0);
  assert.equal(r.ozonCatalog.count,2);
  assert.equal(r.ozonCatalog.confirmed,2);
  assert.equal(r.ozonProfit.count,1);
  assert.equal(r.skuCoverage.profitCostVersionCount,1);
  assert.equal(r.skuCoverage.distinctProfitSkus,1);
  assert.equal(r.skuCoverage.intersectedSkus,1);
  assert.equal(r.skuCoverage.catalogOnlySkuCount,1);
  assert.equal(r.skuCoverage.materialDeliveryCandidates,0);
  assert.ok(r.blockers.includes('ozon_catalog_sku_profit_missing'));
  assert.equal(r.ozonProfit.confirmed,1);
  assert.equal(r.ozonProfit.version,4);
  assert.equal(r.expenses.configuredCount,2);
  assert.equal(r.expenses.businessItems,1);
  assert.equal(r.expenses.ozonDirectItems,1);
  assert.equal(r.expenses.allocationMethod,'unallocated');
  assert.equal(r.possibleArticleLinks.length,1);
  assert.equal(r.possibleArticleLinks[0].mappingStatus,'candidate_not_verified');
  assert.equal(r.ozonProfitCrosschecks[0].sameNominalCost,false);
  assert.ok(r.blockers.includes('ozon_cost_sources_disagree'));
  assert.ok(r.blockers.includes('preliminary_costs_present'));
  assert.equal(r.netProfitKopecks,null);
  assert.equal(r.canonicalSharedCatalogReady,false);
});
test('not-configured Profit or missing WB migration are not represented as verified zero costs',()=>{
  const r=auditUnifiedCostSources({
    month:'2026-11',wbRows:[],wbRegistryStatus:'migration_required',
    ozonCatalogRows:[],
    ozonProfitDocument:null,ozonProfitStatus:'unavailable',
    ozonExpensesDocument:null,ozonExpensesStatus:'unavailable'
  });
  assert.equal(r.wb.status,'migration_required');
  assert.equal(r.ozonProfit.status,'unavailable');
  assert.equal(r.expenses.status,'unavailable');
  assert.ok(r.blockers.includes('ozon_profit_source_unavailable'));
  assert.ok(r.blockers.includes('ozon_expense_source_unavailable'));
  assert.equal(r.skuCoverage.distinctProfitSkus,0);
  assert.equal(r.skuCoverage.expensesReviewed.length,0);
  assert.ok(r.blockers.includes('wb_cost_migration_required'));
  assert.equal(r.netProfitKopecks,null);
});
test('unlinked Ozon SKU must not become WB manufacturing cost by model name alone',()=>{
  const r=auditUnifiedCostSources({
    ...input,ozonCatalogRows:[{
      ...ozonCatalog[0],seller_article:'other-wb-article'
    }]
  });
  assert.equal(r.possibleArticleLinks.length,0);
  assert.equal(r.wb.entries[0].vendorCode,'веста №2');
  assert.equal(r.wb.entries[0].costKopecks,420000);
  assert.equal(r.wb.entries[0].status,'preliminary');
});
test('bad sources, duplicates and cost-version overlap fail closed',()=>{
  assert.throws(()=>auditUnifiedCostSources({
    ...input,wbRows:[...wb,...wb]
  }),/duplicate_wb_cost_version/);
  assert.throws(()=>auditUnifiedCostSources({
    ...input,ozonCatalogRows:[...ozonCatalog,ozonCatalog[0]]
  }),/duplicate_ozon_catalog_sku/);
  assert.throws(()=>auditUnifiedCostSources({
    ...input,ozonCatalogRows:[{...ozonCatalog[0],status:'none'}]
  }),/ozon_catalog_source_invalid/);
  assert.throws(()=>auditUnifiedCostSources({
    ...input,ozonProfitDocument:{entries:[profit.entries[0],
      {...profit.entries[0],validFrom:'2026-09-01'}]}
  }),/ozon_profit_cost_overlap/);
  assert.throws(()=>auditUnifiedCostSources({
    ...input,ozonExpensesDocument:{...expenses,items:[expenses.items[0],expenses.items[0]]}
  }),/ozon_shared_expenses_document_invalid/);
  assert.throws(()=>auditUnifiedCostSources({...input,month:'2026-13'}));
});
