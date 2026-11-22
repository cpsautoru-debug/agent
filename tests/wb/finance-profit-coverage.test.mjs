import test from 'node:test';
import assert from 'node:assert/strict';
import {auditOzonProfitSkuCoverage}
  from '../../web/office/finance-profit-coverage-core.mjs';

const profit=[
  {sku:'1606894548',validFrom:'2026-10-01',validTo:'2026-10-31',
    costKopecks:319900,status:'confirmed',leatherDeliveryIncluded:false},
  {sku:'1606894548',validFrom:'2026-11-01',validTo:null,
    costKopecks:329900,status:'confirmed',leatherDeliveryIncluded:true},
  {sku:'VESTA-3',validFrom:'2026-10-01',validTo:null,
    costKopecks:420000,status:'confirmed',leatherDeliveryIncluded:null}
];
const catalog=[
  {sku:'VESTA-3',sellerArticle:'Vesta-brown',model:'Lada Vesta'},
  {sku:'VESTA-CROSS',sellerArticle:'vesta-cross',model:'Lada Vesta Cross'}
];
const expenses=[
  {id:'delivery',label:'Доставка кожи',amountKopecks:250000,
    scope:'business',validFrom:'2026-10-01',validTo:null,
    leatherDelivery:false},
  {id:'trash',label:'Мусор',amountKopecks:30000,
    scope:'business',validFrom:'2026-10-01',validTo:null,
    leatherDelivery:false},
  {id:'ozon-services',label:'Сервис Ozon',amountKopecks:19000,
    scope:'ozon',validFrom:'2026-10-01',validTo:null,
    leatherDelivery:false}
];
test('36 dated versions are not assumed to be 36 products; exact SKU only',()=>{
  const d=auditOzonProfitSkuCoverage({
    profitEntries:profit,catalogEntries:catalog,expenses});
  assert.equal(d.profitCostVersionCount,3);
  assert.equal(d.distinctProfitSkus,2);
  assert.equal(d.auxiliaryCatalogSkus,2);
  assert.equal(d.intersectedSkus,1);
  assert.equal(d.profitOnlySkuCount,1);
  assert.equal(d.profitOnlySkus[0].sku,'1606894548');
  assert.equal(d.profitOnlySkus[0].versionCount,2);
  assert.equal(d.profitOnlySkus[0].sellerArticle,null);
  assert.equal(d.profitOnlySkus[0].model,null);
  assert.equal(d.catalogOnlySkuCount,1);
  assert.deepEqual(d.catalogOnlySkus,['VESTA-CROSS']);
  assert.equal(d.physicalModelMatchesConfirmed,0);
  assert.equal(d.status,'source_coverage_only');
  assert.equal(d.readOnly,true);
  assert.equal(d.changedRecords,0);
});
test('material-delivery risk is explicit; no expense counted as paid or allocated',()=>{
  const d=auditOzonProfitSkuCoverage({
    profitEntries:profit,catalogEntries:catalog,expenses});
  const delivery=d.expensesReviewed.find(x=>x.id==='delivery');
  assert.equal(delivery.risk,'possible_duplicate_material_delivery');
  assert.equal(delivery.amountKopecks,250000);
  assert.equal(delivery.isRecognizedPayment,false);
  assert.equal(delivery.bookedInUnifiedProfit,false);
  assert.equal(d.materialDeliveryCandidates,1);
  assert.equal(d.anyProfitCostIncludesDelivery,true);
  assert.equal(d.expensesReviewed.find(x=>x.id==='trash').risk,
    'cross_channel_allocation_unconfirmed');
  assert.equal(d.expensesReviewed.find(x=>x.id==='ozon-services').risk,
    'direct_ozon_document_unconfirmed');
});
test('unknown leather-delivery flag is not interpreted as safe zero cost',()=>{
  const d=auditOzonProfitSkuCoverage({
    profitEntries:[profit[2]],catalogEntries:catalog,
    expenses:[expenses[0]]});
  assert.equal(d.materialDeliveryCandidates,1);
  assert.equal(d.expensesReviewed[0].risk,
    'material_delivery_in_cogs_unknown');
  assert.equal(d.deliveryInCostUnknown,true);
  assert.equal(d.anyProfitCostIncludesDelivery,false);
});
test('catalog-only SKU is not automatically linked or given another model cost',()=>{
  const d=auditOzonProfitSkuCoverage({
    profitEntries:[],catalogEntries:catalog,expenses:[]});
  assert.equal(d.catalogOnlySkuCount,2);
  assert.equal(d.distinctProfitSkus,0);
  assert.equal(d.physicalModelMatchesConfirmed,0);
  assert.equal(d.missingCatalogCannotBeLinkedAutomatically,false);
});
test('source with duplicate or malformed product cards fails closed',()=>{
  assert.throws(()=>auditOzonProfitSkuCoverage({
    profitEntries:profit,catalogEntries:[catalog[0],catalog[0]],expenses
  }),/ozon_catalog_identity_incomplete/);
  assert.throws(()=>auditOzonProfitSkuCoverage({
    profitEntries:[{...profit[0],costKopecks:-500}],
    catalogEntries:catalog,expenses}),/ozon_profit_version_invalid/);
  assert.throws(()=>auditOzonProfitSkuCoverage({
    profitEntries:profit,catalogEntries:catalog,
    expenses:[{...expenses[0],amountKopecks:NaN}]}),/expense_source_invalid/);
  assert.throws(()=>auditOzonProfitSkuCoverage({
    profitEntries:profit,catalogEntries:null,expenses:[]}));
});

test('material delivery always requires reconciliation even when COGS says not included',()=>{
  const d=auditOzonProfitSkuCoverage({
    profitEntries:[{sku:'1606894548',validFrom:'2026-10-01',
      validTo:null,costKopecks:319900,status:'confirmed',
      leatherDeliveryIncluded:false}],
    catalogEntries:[],
    expenses:[{id:'delivery',label:'Доставка кожи',
      amountKopecks:2000000,scope:'business',
      validFrom:'2026-10-01',validTo:null,
      leatherDelivery:false}]
  });
  assert.equal(d.materialDeliveryCandidates,1);
  assert.equal(d.expensesReviewed[0].risk,
    'material_delivery_requires_document_check');
  assert.equal(d.anyProfitCostIncludesDelivery,false);
  assert.equal(d.deliveryInCostUnknown,false);
  assert.equal(d.expensesReviewed[0].bookedInUnifiedProfit,false);
});
