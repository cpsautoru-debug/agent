// Read-only projection of existing WB reconciled report aggregates.
// Deliberately not a calendar month, gross selling price, or net profit.
export function wbUnitEvidence(d){
 if(d?.code!=='wb_unit_economics_preview'||d.source!=='WB_FINANCE_API_D1'||d.costEvidenceScope!=='SOLD_UNITS_IN_COMPLETED_REPORTS_NOT_CALENDAR_MONTH'||d.readOnly!==true||d.changedRecords!==0||d.reconciliation!=='matched'||!Array.isArray(d.articles)||d.articles.length>1200)return null;
 const rows=[],seen=new Set(),int=Number.isSafeInteger;
 for(const a of d.articles){
  if(!a||typeof a.vendorCode!=='string'||!a.vendorCode||seen.has(a.vendorCode)||![a.soldUnits,a.returnedUnits,a.unknownSoldUnits,a.unverifiedCostSoldUnits].every(n=>int(n)&&n>=0)||!int(a.payoutKopecks)||!int(a.platformFeesKopecks)||!int(a.knownManufacturingCogsKopecks)||!Array.isArray(a.blockers))return null;
  seen.add(a.vendorCode);
  if(a.soldUnits===0)continue;
  const costComplete=a.unknownSoldUnits===0&&a.unverifiedCostSoldUnits===0;
  rows.push({sku:a.vendorCode,sold:a.soldUnits,returned:a.returnedUnits,payout:a.payoutKopecks,fees:a.platformFeesKopecks,cost:costComplete?a.knownManufacturingCogsKopecks:null,contribution:costComplete&&a.blockers.length===0&&int(a.contributionAfterKnownCogsKopecks)?a.contributionAfterKnownCogsKopecks:null,review:a.returnedUnits>=3&&a.returnedUnits/a.soldUnits>=0.1?'Проверить возвраты':!costComplete?'Уточнить себестоимость':'Уточнить расходы и период',approvedBudget:null});
 }
 return rows.sort((a,b)=>b.sold-a.sold||a.sku.localeCompare(b.sku));
}
