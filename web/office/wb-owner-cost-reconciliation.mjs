// Read-only October 2026 manufacturing-cost audit from owner-confirmed
// per-SKU unit prices embedded in the saved WB XLSX previews.
// This is a management reconstruction, not a statutory accounting register.
const int=Number.isSafeInteger;
const safe=(a,b)=>{const v=a+b;if(!int(v))throw Error('wb_cost_overflow');return v;};
export function reconcileWbOwnerCostSnapshots(month,snapshots,sales){
 if(month!=='2026-10'||!Array.isArray(snapshots)||snapshots.length<1||
   !Array.isArray(sales)||sales.length<1)
   throw Error('wb_cost_evidence_missing');
 const unitCosts=new Map(),reportIds=new Set();
 for(const rec of snapshots){
  if(rec.source!=='USER_SUPPLIED_WB_XLSX'||
    typeof rec.report_id!=='string'||reportIds.has(rec.report_id)||
    typeof rec.snapshot_json!=='string')
   throw Error('wb_xlsx_source_invalid');
  reportIds.add(rec.report_id);
  let data;try{data=JSON.parse(rec.snapshot_json);}
  catch{throw Error('wb_xlsx_json_invalid');}
  if(data.reportId!==rec.report_id||
    !data.periodStart?.startsWith(month)||
    !data.periodEnd?.startsWith(month)||
    !Array.isArray(data.preview?.breakdown))
   throw Error('wb_xlsx_period_invalid');
  const unique=new Set();
  for(const row of data.preview.breakdown){
   if(typeof row.sku!=='string'||!row.sku||unique.has(row.sku)||
     row.costStatus!=='CONFIRMED_BY_USER'||
     !int(row.unitCostKop)||row.unitCostKop<=0||
     !int(row.sales)||row.sales<0||
     !int(row.returns)||row.returns<0)
    throw Error('wb_xlsx_cost_not_confirmed');
   unique.add(row.sku);
   const prev=unitCosts.get(row.sku);
   if(prev!==undefined&&prev!==row.unitCostKop)
    throw Error('wb_xlsx_cost_conflict');
   unitCosts.set(row.sku,row.unitCostKop);
  }
 }
 const soldCodes=new Set();
 let sold=0,returned=0,soldCogs=0,recovered=0;
 const costLines=[];
 for(const row of sales){
  if(typeof row.vendor_code!=='string'||!row.vendor_code||
    soldCodes.has(row.vendor_code)||!int(row.sold_units)||
    row.sold_units<=0||!int(row.returned_units)||
    row.returned_units<0||row.returned_units>row.sold_units)
   throw Error('wb_sales_rows_invalid');
  soldCodes.add(row.vendor_code);
  const cost=unitCosts.get(row.vendor_code);
  if(!int(cost))throw Error('wb_sku_cost_missing');
  sold=safe(sold,row.sold_units);
  returned=safe(returned,row.returned_units);
  const gross=row.sold_units*cost,ret=row.returned_units*cost;
  if(!int(gross)||!int(ret))throw Error('wb_cost_overflow');
  soldCogs=safe(soldCogs,gross);
  recovered=safe(recovered,ret);
  costLines.push({vendorCode:row.vendor_code,unitCostKopecks:cost,
   soldUnits:row.sold_units,resalableReturnedUnits:row.returned_units,
   netCostKopecks:safe(gross,-ret)});
 }
 // These are the specifically verified October sale/return source boundaries.
 if(soldCodes.size!==35||sold!==173||returned!==6||
   snapshots.length!==9||unitCosts.size!==35)
  throw Error('wb_october_coverage_incomplete');
 const net=safe(soldCogs,-recovered);
 return {source:'WB_SAVED_XLSX_OWNER_CONFIRMED_UNIT_COSTS',
  scope:'2026-10',status:'management_cost_reconciled',
  readOnly:true,changedRecords:0,
  confirmedSkuCount:soldCodes.size,confirmedSoldUnits:sold,
  resalableReturnedUnits:returned,snapshotReports:snapshots.length,
  grossManufacturingCostKopecks:soldCogs,
  recoveredReturnCostKopecks:recovered,
  netManufacturingCostKopecks:net,
  costLines:costLines.sort((a,b)=>a.vendorCode.localeCompare(b.vendorCode,'ru')),
  returnBasis:'OWNER_CONFIRMED_ALL_6_RESALABLE_2026_11_24',
  bankAndAdvertisingVerified:false};
}
