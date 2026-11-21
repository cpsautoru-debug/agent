// A conservative, reusable financial boundary for WB -> Ozon unit economics.
// All amounts are exact integer kopecks. "Contribution" means after the
// confirmed manufacturing cost only: NOT net profit, no assumed ad/tax/rent.
// WB report rows lack operation dates, so cost version must cover the entire
// source report period; weekly reports crossing versions are unverified.
export const WB_ACCOUNT='4271851';
export const MAX_GROUPS=1200,MAX_COSTS=2000;
const int=Number.isSafeInteger;
const nonNegative=x=>int(x)&&x>=0;
const code=x=>typeof x==='string'&&x.length>0&&x.length<=200&&
  !/[\u0000-\u001f\u007f]/u.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const safeAdd=(a,b)=>{
  const total=a+b;
  if(!int(total))throw Error('wb_profit_overflow');
  return total;
};
const safeMul=(a,b)=>{
  const result=a*b;
  if(!int(result))throw Error('wb_profit_overflow');
  return result;
};
export function validateUnitCost(row){
  if(!code(row?.vendor_code)||!day(row.valid_from)||
    !(row.valid_to===null||day(row.valid_to)&&row.valid_to>=row.valid_from)||
    !int(row.cost_kopecks)||row.cost_kopecks<=0||row.cost_kopecks>100000000||
    !['preliminary','confirmed'].includes(row.status)||
    typeof row.source!=='string'||row.source.length<3||row.source.length>250||
    /[\u0000-\u001f\u007f]/u.test(row.source))
    throw Error('wb_unit_cost_invalid');
  return {vendorCode:row.vendor_code,validFrom:row.valid_from,
    validTo:row.valid_to,costKopecks:row.cost_kopecks,
    status:row.status,source:row.source};
}
export function findCostForReport(entries,vendorCode,from,to){
  if(!day(from)||!day(to)||from>to)throw Error('wb_report_dates_invalid');
  const matches=entries.filter(x=>x.vendorCode===vendorCode&&x.validFrom<=from&&
    (x.validTo===null||x.validTo>=from));
  if(matches.length===0)return {cost:null,reason:'cost_missing'};
  matches.sort((a,b)=>b.validFrom.localeCompare(a.validFrom));
  const chosen=matches[0];
  if(chosen.validTo!==null&&chosen.validTo<to||
    entries.some(x=>x.vendorCode===vendorCode&&
      x.validFrom>from&&x.validFrom<=to))
    return {cost:null,reason:'cost_version_crosses_report_period'};
  return {cost:chosen,reason:chosen.status==='confirmed'?null:'cost_preliminary'};
}
function validateGroup(row){
  if(row?.vendor_code!==null&&!code(row?.vendor_code)||
    !/^\d{1,20}$/.test(row?.report_id||'')||
    !day(row?.date_from)||!day(row?.date_to)||row.date_from>row.date_to||
    !['complete'].includes(row.status)||
    !nonNegative(row.operation_count)||row.operation_count===0||
    !nonNegative(row.sold_units)||!nonNegative(row.returned_units)||
    !int(row.product_payout_kop)||!int(row.platform_fees_kop)||
    !int(row.additional_payment_kop)||!int(row.paid_acceptance_kop))
    throw Error('wb_finance_group_invalid');
  return row;
}
export function calculateWbSkuBreakdown(groups,rawCosts,stats){
  if(!Array.isArray(groups)||groups.length>MAX_GROUPS||
    !Array.isArray(rawCosts)||rawCosts.length>MAX_COSTS||
    !stats||!nonNegative(stats.complete_reports)||
    !nonNegative(stats.pending_reports)||!int(stats.bank_payout_kop)||
    !nonNegative(stats.completed_operations))
    throw Error('wb_profit_input_invalid');
  const costs=rawCosts.map(validateUnitCost);
  const unique=new Set();
  for(const c of costs){
    const key=c.vendorCode+'|'+c.validFrom;
    if(unique.has(key))throw Error('wb_cost_versions_duplicate');
    unique.add(key);
  }
  const bySku=new Map();
  let totalGroupOperations=0,totalPayout=0,uncodedMoney=0,
    unmodelledMoney=0,unattributedFees=0,coveredSold=0,
    knownCogs=0,unknownSoldUnits=0,returnUnits=0;
  const blockers=new Set();
  for(const raw of groups){
    const row=validateGroup(raw);
    totalGroupOperations=safeAdd(totalGroupOperations,row.operation_count);
    const payout=safeAdd(row.product_payout_kop,-row.platform_fees_kop);
    totalPayout=safeAdd(totalPayout,payout);
    unmodelledMoney=safeAdd(unmodelledMoney,
      safeAdd(row.additional_payment_kop,row.paid_acceptance_kop));
    if(row.vendor_code===null){
      uncodedMoney=safeAdd(uncodedMoney,payout);
      unattributedFees=safeAdd(unattributedFees,row.platform_fees_kop);
      continue;
    }
    let sku=bySku.get(row.vendor_code);
    if(!sku){
      sku={vendorCode:row.vendor_code,soldUnits:0,returnedUnits:0,
        payoutKopecks:0,feesKopecks:0,knownCogsKopecks:0,
        unknownSoldUnits:0,reportIds:new Set(),
        blockers:new Set(),costVersions:new Set()};
      bySku.set(row.vendor_code,sku);
    }
    sku.reportIds.add(row.report_id);
    sku.soldUnits=safeAdd(sku.soldUnits,row.sold_units);
    sku.returnedUnits=safeAdd(sku.returnedUnits,row.returned_units);
    sku.payoutKopecks=safeAdd(sku.payoutKopecks,payout);
    sku.feesKopecks=safeAdd(sku.feesKopecks,row.platform_fees_kop);
    if(row.returned_units){
      sku.blockers.add('return_condition_unverified');
      returnUnits=safeAdd(returnUnits,row.returned_units);
    }
    if(row.sold_units){
      const {cost,reason}=findCostForReport(
        costs,row.vendor_code,row.date_from,row.date_to);
      if(reason)sku.blockers.add(reason);
      if(cost){
        sku.costVersions.add(cost.validFrom);
        const productCost=safeMul(row.sold_units,cost.costKopecks);
        sku.knownCogsKopecks=safeAdd(sku.knownCogsKopecks,productCost);
        knownCogs=safeAdd(knownCogs,productCost);
        if(!reason)coveredSold=safeAdd(coveredSold,row.sold_units);
      }else{
        sku.unknownSoldUnits=safeAdd(sku.unknownSoldUnits,row.sold_units);
        unknownSoldUnits=safeAdd(unknownSoldUnits,row.sold_units);
      }
    }
  }
  if(totalGroupOperations!==stats.completed_operations)
    throw Error('wb_profit_operation_coverage_invalid');
  if(totalPayout!==stats.bank_payout_kop)
    throw Error('wb_profit_payout_reconciliation_failed');
  if(unattributedFees!==0||uncodedMoney!==0)
    blockers.add('unattributed_platform_charges');
  if(returnUnits)blockers.add('return_conditions_missing');
  if(unknownSoldUnits)blockers.add('missing_cost_catalog');
  if(unmodelledMoney!==0)blockers.add('additional_payment_fields_not_reconciled');
  if(stats.pending_reports>0)blockers.add('reports_pending');
  const articles=[...bySku.values()].map(sku=>{
    for(const issue of sku.blockers)blockers.add(issue);
    return {
      vendorCode:sku.vendorCode,soldUnits:sku.soldUnits,
      returnedUnits:sku.returnedUnits,payoutKopecks:sku.payoutKopecks,
      platformFeesKopecks:sku.feesKopecks,
      knownManufacturingCogsKopecks:sku.knownCogsKopecks,
      unknownSoldUnits:sku.unknownSoldUnits,
      contributionAfterKnownCogsKopecks:
        sku.soldUnits>0&&sku.unknownSoldUnits===0&&
        sku.blockers.size===0?
          safeAdd(sku.payoutKopecks,-sku.knownCogsKopecks):null,
      netProfitKopecks:null,
      reportCount:sku.reportIds.size,
      costVersionCount:sku.costVersions.size,
      blockers:[...sku.blockers].sort()
    };
  }).sort((a,b)=>b.soldUnits-a.soldUnits||
    a.vendorCode.localeCompare(b.vendorCode,'ru'));
  return {
    source:'wb_finance_api_complete_reports',
    scope:'ALL_COMPLETED_WB_REPORTS_NOT_CALENDAR_MONTH',
    completeReports:stats.complete_reports,pendingReports:stats.pending_reports,
    bankPayoutKopecks:stats.bank_payout_kop,
    reconciliation:'matched',
    completedOperations:stats.completed_operations,
    skuCount:articles.length,articles,
    totalKnownManufacturingCogsKopecks:knownCogs,
    confirmedCostSoldUnits:coveredSold,
    missingCostSoldUnits:unknownSoldUnits,
    unassignedPayoutKopecks:uncodedMoney,
    unassignedFeesKopecks:unattributedFees,
    unreconciledAdditionalFieldsKopecks:unmodelledMoney,
    knownReturnUnits:returnUnits,
    overheadAllocationStatus:'missing',
    advertisingStatus:'missing',
    taxStatus:'missing',
    netProfitKopecks:null,
    blockers:[...new Set([...blockers,'advertising_missing','tax_register_missing',
      'shared_overheads_missing','calendar_period_not_verified'])].sort()
  };
}
// This strict boundary is shared with the future Ozon/common-expense model.
// It cannot invent a final net figure with incomplete advertising, legal-entity
// tax register, driver/packer/manager overhead, or missing raw source coverage.
export function finalProfitGate({contributionKopecks,advertisingKopecks,
  taxKopecks,allocatedOverheadsKopecks,allSourcesComplete}){
  if(![contributionKopecks,advertisingKopecks,taxKopecks,
    allocatedOverheadsKopecks].every(int)||allSourcesComplete!==true)
    return {netProfitKopecks:null,status:'unverified'};
  return {netProfitKopecks:safeAdd(safeAdd(contributionKopecks,-advertisingKopecks),
    -safeAdd(taxKopecks,allocatedOverheadsKopecks)),status:'verified'};
}
