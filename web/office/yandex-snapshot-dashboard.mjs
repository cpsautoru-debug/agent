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
   missingProducts:e.skus.filter(x=>x?.deliveredUnits>0&&
    x.costKopecks===null).slice(0,30).map(x=>({
     shopSku:String(x.shopSku||'').slice(0,150),
     name:String(x.name||'').slice(0,200)})),
   issues:e.issues.length,
   issueDetails:e.issues.slice(0,10).map(x=>({
    partnerId:x.partnerId,reason:String(x.reason||'unknown').slice(0,80)})),
   netProfitKopecks:null};
 return blocked('preliminary_calculation_invalid');
}

const serverCache=new Map(),inFlight=new Map();
export function interpretYandexDirectCostReview(month,data){
 const unavailable={month,status:'unavailable',cogsKopecks:null,
  preliminaryContributionKopecks:null,missingCount:null,
  netProfitKopecks:null};
 if(!monthValid(month)||data?.code!=='yandex_direct_cost_review'||
  data.readOnly!==true||data.month!==month||
  data.ownerEntity!=='ИП Жилина Ольга'||
  data.netProfitKopecks!==null||
  !Array.isArray(data.missing)||!Array.isArray(data.issues))
  return unavailable;
 if(data.status==='preliminary_cost_reconciled'&&
    int(data.cogsKopecks)&&int(data.preliminaryContributionKopecks)&&
    int(data.incomeKopecks)&&
    data.incomeKopecks-data.cogsKopecks===
     data.preliminaryContributionKopecks&&
    data.missing.length===0&&data.issues.length===0)
  return {month,status:'preliminary_cost_reconciled',
   cogsKopecks:data.cogsKopecks,
   preliminaryContributionKopecks:data.preliminaryContributionKopecks,
   missingCount:0,netProfitKopecks:null,
   source:'server_direct_yandex_report_and_cost_audit'};
 if(data.status==='incomplete_cost_coverage')
  return {month,status:'incomplete_cost_coverage',
   cogsKopecks:null,preliminaryContributionKopecks:null,
   reviewContributionBeforeReturnsKopecks:
    int(data.reviewContributionBeforeReturnsKopecks)?
     data.reviewContributionBeforeReturnsKopecks:null,
   missingCount:data.missing.length,
   missingProducts:data.missing.slice(0,30).map(x=>({
    partnerId:[149082506,149106500].includes(x.partnerId)?x.partnerId:null,
    shopSku:String(x.shopSku||'').slice(0,150),
    name:String(x.name||'').slice(0,200),
    deliveredUnits:int(x.deliveredUnits)&&x.deliveredUnits>=0?
     x.deliveredUnits:null,
    returnedUnits:int(x.returnedUnits)&&x.returnedUnits>=0?
     x.returnedUnits:null})),
   issues:data.issues.length,
   blockers:Array.isArray(data.blockers)?
    data.blockers.filter(x=>typeof x==='string').slice(0,20):[],
   issueDetails:data.issues.slice(0,10).map(x=>({
    partnerId:x.partnerId,reason:String(x.reason||'unknown').slice(0,80)})),
   netProfitKopecks:null,
   source:'server_direct_yandex_report_and_cost_audit'};
 return unavailable;
}
export async function loadYandexCostSnapshot(month,fetcher=fetch){
 const unavailable={month,status:'unavailable',cogsKopecks:null,
  preliminaryContributionKopecks:null,missingCount:null,
  netProfitKopecks:null};
 if(!monthValid(month))return unavailable;
 const cacheKey=month;
 const cached=serverCache.get(cacheKey);
 if(fetcher===fetch&&cached&&Date.now()-cached.at<10*60*1000)
  return {...cached.value};
 if(fetcher===fetch&&inFlight.has(cacheKey))return inFlight.get(cacheKey);
 const job=(async()=>{
  try{
   const options={method:'GET',credentials:'same-origin',
    cache:'no-store',signal:AbortSignal.timeout(30000)};
   // Prefer fresh authorized API evidence after seller perimeter and SKU
   // cost changes. A previously persisted browser snapshot can be stale.
   const direct=await fetcher('/api/yandex/direct-cost-review?month='+
    encodeURIComponent(month),options);
   if(direct.ok){
    const result=interpretYandexDirectCostReview(month,await direct.json());
    if(result.status!=='unavailable'){
     if(fetcher===fetch)serverCache.set(cacheKey,{at:Date.now(),value:result});
     return result;
    }
   }
   // Read the historical snapshot only as a fallback. Never combine
   // totals from different revisions of the same period.
   const response=await fetcher('/api/yandex/evidence-snapshot?month='+
    encodeURIComponent(month),options);
   if(!response.ok)return unavailable;
   const checked=interpretYandexCostSnapshot(month,await response.json());
   if(checked.status!=='unavailable'){
    if(fetcher===fetch)serverCache.set(cacheKey,{at:Date.now(),value:checked});
    return checked;
   }
   return unavailable;
  }catch{return unavailable;}
  finally{inFlight.delete(cacheKey);}
 })();
 if(fetcher===fetch)inFlight.set(cacheKey,job);
 return job;
}
