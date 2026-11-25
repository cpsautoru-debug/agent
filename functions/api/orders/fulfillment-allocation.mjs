import {allocateStock} from './fulfillment-stock.mjs';
import {allocateProduction} from './fulfillment-production.mjs';

// Pure, deterministic calculation. A caller must prove the entire shared
// obligation cohort (MoySklad and external marketplaces) before invoking it.
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=180;
const unverified=reason=>({status:'requires_review',reason,
 warehouseCovered:null,plannedCovered:null,missing:null});

export function calculateFulfillmentCohort({balance,warehouseOccupancy,production,
 claims,marketplaceCoverage,sourceSnapshot,warehouseId,itemId}={}){
 if(!nonempty(warehouseId)||!nonempty(itemId)||
   balance?.status!=='accounting_verified'||!integer(balance.stock)||
   !integer(balance.reserve)||balance.reserve>balance.stock)
  return unverified('availability_unverified');
 if(warehouseOccupancy?.status!=='warehouse_orders_verified'||
    !integer(warehouseOccupancy.warehouseAdditional)||
    !integer(warehouseOccupancy.reconciledReserve)||
    warehouseOccupancy.reconciledReserve!==balance.reserve)
  return unverified('competing_order_coverage_unverified');
 if(production?.status!=='production_verified'||!Array.isArray(production.jobs))
  return unverified('production_unverified');
 if(marketplaceCoverage?.complete!==true||
    marketplaceCoverage?.deduplicated!==true||
    marketplaceCoverage?.allSourcesCurrent!==true||
    marketplaceCoverage?.allClaimsMapped!==true||
    sourceSnapshot?.complete!==true)
  return unverified('marketplace_coverage_unverified');
 if(!Array.isArray(claims)||claims.length===0||claims.length>500)
  return unverified('marketplace_coverage_unverified');
 // Each claim is a globally unique customer obligation, not a channel row.
 // A missing proof of duplicate reconciliation blocks allocation.
 const seen=new Set();
 const normalized=[];
 let warehouseReserved=0,warehouseOpen=0;
 for(const claim of claims){
  if(!nonempty(claim.key)||seen.has(claim.key)||claim.itemId!==itemId||
    claim.storeId!==warehouseId||!integer(claim.ordered)||claim.ordered===0||
    !integer(claim.reserved)||claim.reserved>claim.ordered||
    !['moysklad','marketplace'].includes(claim.origin)||
    !nonempty(claim.identity)||!nonempty(claim.orderKey)||
    (claim.deadline!==null&&claim.deadline!==undefined&&
     !Number.isFinite(Date.parse(claim.deadline)))||
    (claim.origin==='marketplace'&&claim.reconciledWithMoySklad!==true&&
     claim.reconciledWithMoySklad!==false))return unverified('marketplace_coverage_unverified');
  seen.add(claim.key);
  if(claim.origin==='moysklad'){
   warehouseReserved+=claim.reserved;
   warehouseOpen+=claim.ordered-claim.reserved;
  }
  normalized.push({...claim});
 }
 if(warehouseReserved!==balance.reserve||
    warehouseOpen!==warehouseOccupancy.warehouseAdditional)
  return unverified('competing_order_coverage_unverified');
 // All unreserved commitments of a warehouse share the same free pool.
 // Do not count the same obligation both as a MoySklad document and
 // a marketplace order. Each external claim must have explicit dedupe proof.
 const canonical=new Map();
 for(const claim of normalized){
  const prev=canonical.get(claim.identity);
  if(prev){
   if(claim.origin===prev.origin||claim.ordered!==prev.ordered||
      claim.reserved!==0&&prev.reserved!==0||
      claim.reconciledWithMoySklad!==true&&
      prev.reconciledWithMoySklad!==true)
    return unverified('marketplace_coverage_unverified');
   const ms=claim.origin==='moysklad'?claim:prev;
   const ext=claim.origin==='marketplace'?claim:prev;
   if(ext.reconciledWithMoySklad!==true)
    return unverified('marketplace_coverage_unverified');
   canonical.set(claim.identity,{...ms,key:ext.key,orderKey:ext.orderKey,
    deadline:ext.deadline??ms.deadline,orderId:ms.orderId??null,
    origin:'linked'});
  }else{
   if(claim.origin==='marketplace'&&claim.reconciledWithMoySklad===true)
    return unverified('marketplace_coverage_unverified');
   canonical.set(claim.identity,claim);
  }
 }
 const ordered=[...canonical.values()].sort((a,b)=>{
  const dateA=Date.parse(a.deadline)||Infinity,dateB=Date.parse(b.deadline)||Infinity;
  return dateA-dateB||a.key.localeCompare(b.key);
 });
 if(new Set(ordered.map(x=>x.key)).size!==ordered.length)
  return unverified('marketplace_coverage_unverified');
 const stock=allocateStock(balance,ordered,true);
 if(!stock)return unverified('competing_order_coverage_unverified');
 const jobs=production.jobs;
 // A dated production commitment cannot be assumed to cover an undated
 // customer order, nor may its absence be treated as zero planned output.
 if(jobs.some(job=>Number(job.pending)>0)&&ordered.some((claim,i)=>
    stock[i].missing>0&&!claim.deadline))
  return unverified('production_unverified');
 if(jobs.some(x=>!integer(x.pending)||!nonempty(x.id)||
  !Array.isArray(x.customerOrderIds)||!Array.isArray(x.taskIds)&&x.taskIds!==undefined))
  return unverified('production_unverified');
 const planning=allocateProduction(jobs,stock.map((x,i)=>({
  key:x.key,missing:x.missing,deadline:ordered[i].deadline??null,
  orderId:ordered[i].orderId??null
 })));
 if(planning.length!==ordered.length||planning.some((x,i)=>
    !integer(x.planned)||!integer(x.missing)||
    x.planned+x.missing!==stock[i].missing))
  return unverified('production_unverified');
 return {status:'calculated',reason:null,
  lines:ordered.map((claim,i)=>({
   key:claim.key,orderKey:claim.orderKey,itemId,storeId:warehouseId,
   ordered:claim.ordered,reservedCovered:stock[i].reserved,
   warehouseCovered:stock[i].covered,
   plannedCovered:planning[i].planned,missing:planning[i].missing,
   productionTaskIds:planning[i].taskIds
  }))};
}
