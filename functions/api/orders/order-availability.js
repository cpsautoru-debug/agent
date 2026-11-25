// Strict, read-only production shortfall projections.
// An accounting stock report does not prove physical availability and
// cannot authorize reservations, production jobs or dispatch.
export function projectOrderLine({ordered,stock,reserve,otherAllocations=0,
  storeConfirmed=false,itemConfirmed=false,stockConfirmed=false,
  allocationsConfirmed=false,orderActive=false}){
 const valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e8;
 if(!valid(ordered)||ordered<=0)throw Error('invalid_order_quantity');
 if(!orderActive)return {state:'not_for_sewing',ordered,pickable:null,missing:null,
  reason:'order_not_active'};
 if(!itemConfirmed)return {state:'unverified',ordered,pickable:null,missing:null,
  reason:'item_mapping_unverified'};
 if(!storeConfirmed)return {state:'unverified',ordered,pickable:null,missing:null,
  reason:'order_store_unverified'};
 if(!stockConfirmed||!valid(stock)||!valid(reserve))return {
  state:'unverified',ordered,pickable:null,missing:null,
  reason:'accounting_stock_or_reserve_unverified'};
 if(!allocationsConfirmed||!valid(otherAllocations))return {
  state:'unverified',ordered,pickable:null,missing:null,
  reason:'other_order_allocations_unverified'};
 // This remains a theoretical accounting projection even with all the above.
 const available=Math.max(0,stock-reserve-otherAllocations);
 const plannedPick=Math.min(ordered,available);
 return {state:'accounting_projection_only',ordered,
  accountingFree:available,provisionalPick:plannedPick,
  provisionalMissing:ordered-plannedPick,pickable:null,missing:null,
  reason:'physical_stock_and_existing_production_unverified'};
}
