// Separate *dated cost versions* from unique SKU identity.
// Profit contains cost history but not confirmed seller article/model mapping.
// Read-only; never convert the version list into the verified link registry.
const text=x=>typeof x==='string'&&x.trim()!==''&&!/[\u0000-\u001f\u007f]/u.test(x);
const sort=(a,b)=>a.localeCompare(b,'ru');
export function auditOzonProfitSkuCoverage({profitEntries,catalogEntries,expenses}){
  if(!Array.isArray(profitEntries)||profitEntries.length>2000||
    !Array.isArray(catalogEntries)||catalogEntries.length>5000||
    !Array.isArray(expenses)||expenses.length>500)
    throw Error('ozon_profit_coverage_invalid');
  const catalog=new Map();
  for(const item of catalogEntries){
    if(!text(item?.sku)||!text(item?.sellerArticle)||
      catalog.has(item.sku))throw Error('ozon_catalog_identity_incomplete');
    catalog.set(item.sku,item);
  }
  const byProfitSku=new Map();
  for(const version of profitEntries){
    if(!text(version?.sku)||!text(version?.validFrom)||
      !['confirmed','preliminary'].includes(version.status)||
      !Number.isSafeInteger(version.costKopecks)||version.costKopecks<=0)
      throw Error('ozon_profit_version_invalid');
    const versions=byProfitSku.get(version.sku)||[];
    versions.push(version);byProfitSku.set(version.sku,versions);
  }
  const profitOnly=[...byProfitSku.entries()]
    .filter(([sku])=>!catalog.has(sku))
    .map(([sku,versions])=>({
      sku,versionCount:versions.length,
      periods:versions.map(x=>({
        validFrom:x.validFrom,validTo:x.validTo,
        costKopecks:x.costKopecks,status:x.status
      })).sort((a,b)=>sort(a.validFrom,b.validFrom)),
      sellerArticle:null,model:null,
      identityStatus:'sku_only_no_product_card'
    })).sort((a,b)=>sort(a.sku,b.sku));
  const catalogOnly=[...catalog.keys()].filter(sku=>!byProfitSku.has(sku)).sort(sort);
  const both=[...catalog.keys()].filter(sku=>byProfitSku.has(sku)).sort(sort);
  const distinctProfitSkus=byProfitSku.size;
  const physicalModelMatchesConfirmed=0;
  const deliveryLabel=/(?:достав|перевоз|транспортиров)[^]{0,55}(?:кож|материал|экокож|алькантар)|(?:кож|материал|экокож|алькантар)[^]{0,55}(?:достав|перевоз|транспортиров)/iu;
  const deliveryCostVersions=profitEntries.filter(x=>x.leatherDeliveryIncluded===true);
  const deliveryUnknownVersions=profitEntries.filter(x=>x.leatherDeliveryIncluded===null);
  const expensesReviewed=expenses.map(item=>{
    if(!text(item?.id)||!text(item.label)||!['business','ozon'].includes(item.scope)||
      !Number.isSafeInteger(item.amountKopecks)||item.amountKopecks<0)
      throw Error('expense_source_invalid');
    const materialDelivery=deliveryLabel.test(item.label)||
      item.leatherDelivery===true;
    const risk=materialDelivery?
      deliveryCostVersions.length>0?'possible_duplicate_material_delivery':
        deliveryUnknownVersions.length>0?'material_delivery_in_cogs_unknown':
          'material_delivery_requires_document_check':
      item.scope==='business'?'cross_channel_allocation_unconfirmed':
      'direct_ozon_document_unconfirmed';
    return {
      id:item.id,label:item.label,scope:item.scope,
      amountKopecks:item.amountKopecks,
      validFrom:item.validFrom,validTo:item.validTo,
      risk,isRecognizedPayment:false,
      bookedInUnifiedProfit:false
    };
  });
  // Every material delivery entry requires a source/inclusion review, even
  // if every cost version explicitly says delivery is excluded.
  // A zero count means zero delivery entries, NOT proof of no double count.
  const flagged=expensesReviewed.filter(x=>[
    'possible_duplicate_material_delivery',
    'material_delivery_in_cogs_unknown',
    'material_delivery_requires_document_check'
  ].includes(x.risk));
  return {
    profitCostVersionCount:profitEntries.length,
    distinctProfitSkus,
    auxiliaryCatalogSkus:catalog.size,
    intersectedSkus:both.length,
    profitOnlySkus:profitOnly,
    profitOnlySkuCount:profitOnly.length,
    catalogOnlySkus:catalogOnly,
    catalogOnlySkuCount:catalogOnly.length,
    physicalModelMatchesConfirmed,
    status:'source_coverage_only',
    expensesReviewed,
    materialDeliveryCandidates:flagged.length,
    anyProfitCostIncludesDelivery:deliveryCostVersions.length>0,
    deliveryInCostUnknown:deliveryUnknownVersions.length>0,
    missingCatalogCannotBeLinkedAutomatically:profitOnly.length>0,
    readOnly:true,
    changedRecords:0
  };
}
