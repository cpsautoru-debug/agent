// A single read-only inventory of the CURRENT DIFFERENT financial cost sources.
// This is not yet a canonical write ledger. There is no automatic cross-channel
// cost transfer: a WB article and Ozon SKU must be explicitly verified.
import {validateUnitCost} from './wb-unit-economics-core.mjs';
const valid=(x,max)=>typeof x==='string'&&x.trim().length>0&&
  x.length<=max&&!/[\u0000-\u001f\u007f]/u.test(x);
const safe=x=>Number.isSafeInteger(x)&&x>0&&x<=100000000;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const sort=(a,b)=>a.localeCompare(b,'ru');

export function auditUnifiedCostSources({
  month,wbRows=[],wbRegistryStatus='ready',
  ozonCatalogRows=[],ozonProfitDocument=null,
  ozonProfitStatus='ready',ozonExpensesDocument=null,
  ozonExpensesStatus='ready',profitVersion=0,expenseVersion=0
}){
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||
    !Array.isArray(wbRows)||wbRows.length>2000||
    !Array.isArray(ozonCatalogRows)||ozonCatalogRows.length>5000||
    !['ready','migration_required'].includes(wbRegistryStatus)||
    !['ready','unavailable'].includes(ozonProfitStatus)||
    !['ready','unavailable'].includes(ozonExpensesStatus)||
    ![profitVersion,expenseVersion].every(n=>Number.isSafeInteger(n)&&n>=0))
    throw Error('shared_source_coverage_invalid');
  const wb=wbRows.map(row=>validateUnitCost(row));
  const known=new Set();
  for(const row of wb){
    const key=JSON.stringify([row.vendorCode,row.validFrom]);
    if(known.has(key))throw Error('duplicate_wb_cost_version');
    known.add(key);
  }
  const ozonCatalog=ozonCatalogRows.map(row=>{
    if(!valid(row?.sku,150)||!valid(row?.seller_article,250)||
      !valid(row?.model,100)||!safe(row?.cost_kopecks)||
      !['confirmed','preliminary'].includes(row.status)||
      !valid(row?.source,250))throw Error('ozon_catalog_source_invalid');
    return {sku:row.sku,sellerArticle:row.seller_article,
      model:row.model,costKopecks:row.cost_kopecks,
      status:row.status,source:row.source};
  });
  const skuIds=new Set();
  for(const row of ozonCatalog){
    if(skuIds.has(row.sku))throw Error('duplicate_ozon_catalog_sku');
    skuIds.add(row.sku);
  }
  const ozonProfit=ozonProfitDocument===null?[]:(()=>{
    if(typeof ozonProfitDocument!=='object'||
      !Array.isArray(ozonProfitDocument.entries)||
      ozonProfitDocument.entries.length>2000)
      throw Error('ozon_profit_cost_document_invalid');
    return ozonProfitDocument.entries.map(row=>{
      if(!valid(row?.sku,150)||!safe(row.costKopecks)||
        !date(row.validFrom)||
        (row.validTo!==null&&(!date(row.validTo)||
          row.validTo<row.validFrom))||
        !['confirmed','preliminary'].includes(row.status)||
        !valid(row.source,250)||
        !(row.leatherDeliveryIncluded===null||
          typeof row.leatherDeliveryIncluded==='boolean'))
        throw Error('ozon_profit_cost_document_invalid');
      return {sku:row.sku,validFrom:row.validFrom,
        validTo:row.validTo,costKopecks:row.costKopecks,
        status:row.status,source:row.source};
    });
  })();
  for(let i=0;i<ozonProfit.length;i++)for(let j=i+1;j<ozonProfit.length;j++){
    const a=ozonProfit[i],b=ozonProfit[j];
    if(a.sku===b.sku&&a.validFrom<=(b.validTo||'9999-12-31')&&
      b.validFrom<=(a.validTo||'9999-12-31'))
      throw Error('ozon_profit_cost_overlap');
  }
  const expenseItems=ozonExpensesDocument===null?[]:(()=>{
    if(!ozonExpensesDocument||
      !Array.isArray(ozonExpensesDocument.items)||
      ozonExpensesDocument.items.length>500||
      !['unallocated','shares','revenue'].includes(
        ozonExpensesDocument.allocation?.method))
      throw Error('ozon_shared_expenses_document_invalid');
    const seen=new Set();
    return ozonExpensesDocument.items.map(item=>{
      if(!valid(item?.id,200)||seen.has(item.id)||
        !valid(item.label,250)||!Number.isSafeInteger(item.amountKopecks)||
        item.amountKopecks<0||!['ozon','business'].includes(item.scope)||
        !date(item.validFrom)||(
          item.validTo!==null&&(!date(item.validTo)||
            item.validTo<item.validFrom)))
        throw Error('ozon_shared_expenses_document_invalid');
      seen.add(item.id);
      return {id:item.id,label:item.label,scope:item.scope,
        validFrom:item.validFrom,validTo:item.validTo};
    });
  })();
  const wbCodes=new Set(wb.map(x=>x.vendorCode));
  const bySku=new Map(ozonCatalog.map(x=>[x.sku,x]));
  const exact=[];
  for(const item of ozonCatalog){
    if(!wbCodes.has(item.sellerArticle))continue;
    const matching=wb.filter(x=>x.vendorCode===item.sellerArticle);
    exact.push({sellerArticle:item.sellerArticle,sku:item.sku,
      ozonCostKopecks:item.costKopecks,
      ozonCostStatus:item.status,wbVersions:matching.map(x=>({
        costKopecks:x.costKopecks,status:x.status,
        validFrom:x.validFrom
      })),mappingStatus:'candidate_not_verified'});
  }
  const profitCrosschecks=ozonProfit.map(row=>{
    const ref=bySku.get(row.sku);
    return {sku:row.sku,versionFrom:row.validFrom,
      status:row.status,profitCostKopecks:row.costKopecks,
      catalogCostKopecks:ref?.costKopecks??null,
      sameNominalCost:ref?ref.costKopecks===row.costKopecks:null,
      sellerArticle:ref?.sellerArticle??null};
  });
  const blockers=['wb_ozon_link_not_confirmed',
    'advertising_not_integrated','tax_registry_not_integrated',
    'shared_expense_allocation_not_integrated'];
  if(wbRegistryStatus!=='ready')blockers.push('wb_cost_migration_required');
  if(ozonProfitStatus!=='ready')blockers.push('ozon_profit_source_unavailable');
  if(ozonExpensesStatus!=='ready')blockers.push('ozon_expense_source_unavailable');
  if(ozonProfitDocument===null)blockers.push('ozon_profit_costs_not_configured');
  if(ozonExpensesDocument===null)blockers.push('ozon_expenses_not_configured');
  if(wb.some(x=>x.status!=='confirmed')||
    ozonCatalog.some(x=>x.status!=='confirmed')||
    ozonProfit.some(x=>x.status!=='confirmed'))
    blockers.push('preliminary_costs_present');
  if(profitCrosschecks.some(x=>x.sameNominalCost===false))
    blockers.push('ozon_cost_sources_disagree');
  return {
    code:'unified_finance_source_audit',readOnly:true,changedRecords:0,
    source:'WB_D1_PLUS_OZON_COSTS_PLUS_OZON_PROFIT_RPC',month,
    wb:{status:wbRegistryStatus,entries:wb.sort((a,b)=>
      sort(a.vendorCode,b.vendorCode)||sort(a.validFrom,b.validFrom)),
      count:wb.length,confirmed:wb.filter(x=>x.status==='confirmed').length,
      preliminary:wb.filter(x=>x.status==='preliminary').length},
    ozonCatalog:{entries:ozonCatalog.sort((a,b)=>sort(a.sku,b.sku)),
      count:ozonCatalog.length,
      confirmed:ozonCatalog.filter(x=>x.status==='confirmed').length,
      preliminary:ozonCatalog.filter(x=>x.status==='preliminary').length},
    ozonProfit:{status:ozonProfitStatus,version:profitVersion,
      entries:ozonProfit.sort((a,b)=>sort(a.sku,b.sku)),
      count:ozonProfit.length,
      confirmed:ozonProfit.filter(x=>x.status==='confirmed').length,
      preliminary:ozonProfit.filter(x=>x.status==='preliminary').length},
    expenses:{status:ozonExpensesStatus,version:expenseVersion,
      configuredCount:expenseItems.length,
      businessItems:expenseItems.filter(x=>x.scope==='business').length,
      ozonDirectItems:expenseItems.filter(x=>x.scope==='ozon').length,
      allocationMethod:ozonExpensesDocument?.allocation?.method||'not_configured',
      items:expenseItems},
    possibleArticleLinks:exact.sort((a,b)=>sort(a.sellerArticle,b.sellerArticle)),
    ozonProfitCrosschecks:profitCrosschecks,
    netProfitKopecks:null,canonicalSharedCatalogReady:false,
    blockers
  };
}
