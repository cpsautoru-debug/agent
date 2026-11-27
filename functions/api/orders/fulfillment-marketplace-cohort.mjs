import {manualItemReason} from '../../../web/office/manual-item-policy.mjs';
import {classifyOrderBucket} from './order-buckets.js';
import {calculateFulfillmentCohort} from './fulfillment-allocation.mjs';

const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORDER=/^AS63:(ozon|wb|yandex):[A-Za-z0-9._-]{1,100}:[A-Za-z0-9._-]{1,100}$/;
const blocked=reason=>({status:'requires_review',reason,missing:null});

export function assembleLiveCohort(lines,msClaims,itemId,storeId,targetOrderKey){
 if(!Array.isArray(lines)||lines.length>1000||!Array.isArray(msClaims)||
  !ID.test(itemId)||!ID.test(storeId)||typeof targetOrderKey!=='string')
  return blocked('marketplace_coverage_unverified');
 const external=[];
 const seen=new Set();
 let found=false;
 for(const row of lines){
  if(!ORDER.test(row?.order_key||'')||!Number.isSafeInteger(row.line_index)||
     row.line_index<0||row.line_index>49||
     typeof row.source!=='string'||typeof row.source_status!=='string'||
     row.order_key.split(':')[1]!==row.source)
   return blocked('marketplace_coverage_unverified');
  const key=row.order_key+':line:'+row.line_index;
  if(seen.has(key))return blocked('marketplace_coverage_unverified');
  seen.add(key);
  const bucket=classifyOrderBucket({source:row.source,source_status:row.source_status}).bucket;
  if(bucket==='review')return blocked('marketplace_coverage_unverified');
  if(bucket!=='active')continue;
  // Manual handling is not proof that the obligation uses independent stock.
  if(manualItemReason(row.source,row.sku))return blocked('manual_stock_scope_unverified');
  if(!Number.isSafeInteger(row.quantity)||row.quantity<=0||
     !ID.test(row.ms_item_id||'')||!ID.test(row.store_id||''))
   return blocked('marketplace_claim_unmapped');
  if(row.ms_item_id!==itemId||row.store_id!==storeId)continue;
  if(row.order_key===targetOrderKey)found=true;
  external.push({key,orderKey:row.order_key,itemId,storeId,
   ordered:row.quantity,reserved:0,origin:'marketplace',
   identity:row.order_key,reconciledWithMoySklad:false,deadline:null});
 }
 if(!found)return blocked('target_order_not_in_full_snapshot');
 const msIds=new Set(),msClaimsForItem=[];
 const msExternal=new Set();
 for(const claim of msClaims){
  if(!claim||claim.itemId!==itemId||claim.storeId!==storeId||
     typeof claim.orderId!=='string'||msIds.has(claim.orderId))
   return blocked('competing_order_coverage_unverified');
  msIds.add(claim.orderId);
  if(claim.externalOrderKey){
   if(!ORDER.test(claim.externalOrderKey)||msExternal.has(claim.externalOrderKey))
    return blocked('marketplace_duplicates_unverified');
   msExternal.add(claim.externalOrderKey);
   msClaimsForItem.push({...claim,identity:claim.externalOrderKey});
  }else{
   // An unspecified MoySklad origin might already be the marketplace order.
   // No name/quantity guessing is permitted to disambiguate this.
   if(external.length)return blocked('marketplace_duplicates_unverified');
   msClaimsForItem.push({...claim});
  }
 }
 const marketKeys=new Set(external.map(x=>x.orderKey));
 if([...msExternal].some(key=>!marketKeys.has(key)))
  return blocked('marketplace_duplicates_unverified');
 // Existing MoySklad commitments must be registered before their
 // marketplace mirrors so reconciliation cannot treat a mirror as standalone.
 const claims=msClaimsForItem.concat(
  external.map(x=>({...x,reconciledWithMoySklad:msExternal.has(x.orderKey)})));
 return {status:'cohort_verified',claims};
}

export async function readLiveMarketplaceLines(db){
 // All sources must be proven complete independently before this read.
 // Include unknown statuses to fail closed, never silently skip competitors.
 const result=await db.prepare(`SELECT q.order_key,q.source,q.source_status,
  CAST(j.key AS INTEGER) AS line_index,
  json_extract(j.value,'$.quantity') AS quantity,
  json_extract(j.value,'$.sku') AS sku,
  l.ms_item_id,r.store_id
 FROM office_order_queue q
 JOIN office_order_queue_sync s ON s.source=q.source AND s.last_success_at=q.source_checked_at
 JOIN json_each(q.items_json) j
 LEFT JOIN office_order_sku_links l ON l.source=q.source AND l.seller_account=q.account
  AND l.marketplace_sku=json_extract(j.value,'$.sku')
 LEFT JOIN office_order_warehouse_routes r ON r.source=q.source AND r.seller_account=q.account
 WHERE q.source IN ('ozon','wb','yandex')
 ORDER BY q.order_key,j.key LIMIT 1001`).all();
 if(!Array.isArray(result?.results)||result.results.length>1000)
  return null;
 return result.results;
}

export function calculateLiveOrder({sourceLines,occupancy,accounting,production,
 itemId,storeId,orderKey,sourceCoverage}={}){
 if(sourceCoverage?.complete!==true)return blocked('marketplace_coverage_unverified');
 if(occupancy?.status!=='warehouse_orders_verified'||!Array.isArray(occupancy.claims))
  return blocked('competing_order_coverage_unverified');
 const cohort=assembleLiveCohort(sourceLines,occupancy.claims,itemId,storeId,orderKey);
 if(cohort.status!=='cohort_verified')return cohort;
 return calculateFulfillmentCohort({
  balance:accounting,warehouseOccupancy:occupancy,production,
  claims:cohort.claims,marketplaceCoverage:{
   complete:true,deduplicated:true,allSourcesCurrent:true,allClaimsMapped:true},
  sourceSnapshot:{complete:true},warehouseId:storeId,itemId
 });
}
