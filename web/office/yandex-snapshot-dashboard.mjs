// Read-only presentation of the owner-authorized Yandex per-SKU cost snapshot.
// A snapshot's preliminary contribution is not tax or bank reconciled profit.
const int=x=>Number.isSafeInteger(x);
const monthValid=x=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(x||'');
export function interpretYandexCostSnapshot(month,data){
 const blocked=(reason)=>({status:'unavailable',reason,month,
  cogsKopecks:null,preliminaryContributionKopecks:null,
  missingCount:null,netProfitKopecks:null});
 if(!monthValid(month)||data?.code!=='yandex_month_evidence_available'||
  data.readOnly!==true||data.month!==month||
  data.sourceKind!=='owner_browser_audited_summary'||
  data.evidence?.ownerEntity!=='ИП Жилина Ольга'||
  data.evidence?.netProfitKopecks!==null||
  !Array.isArray(data.evidence?.skus)||data.evidence.skus.length>500||
  !Array.isArray(data.evidence?.issues))
  return blocked('owner_cost_snapshot_not_verified');
 const e=data.evidence,missing=e.skus.filter(x=>
  int(x?.deliveredUnits)&&x.deliveredUnits>0&&
  x.costKopecks===null).length;
 if(e.status==='preliminary_contribution_ready'&&
  int(e.preliminaryContributionKopecks)&&int(e.deliveredCostKopecks)&&
  int(e.orderAfterServiceKopecks)&&
  e.orderAfterServiceKopecks-e.deliveredCostKopecks===
   e.preliminaryContributionKopecks&&missing===0&&e.issues.length===0)
  return {month,status:'preliminary_cost_reconciled',
   cogsKopecks:e.deliveredCostKopecks,
   preliminaryContributionKopecks:e.preliminaryContributionKopecks,
   missingCount:0,netProfitKopecks:null};
 if(e.status==='partial')
  return {month,status:'incomplete_cost_coverage',
   cogsKopecks:int(e.deliveredCostKopecks)?e.deliveredCostKopecks:null,
   preliminaryContributionKopecks:null,missingCount:missing,
   issues:e.issues.length,netProfitKopecks:null};
 return blocked('preliminary_calculation_invalid');
}
