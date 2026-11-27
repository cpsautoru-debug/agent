// Conservative order bucket classification from a verified upstream status.
// Never treats a displayed bucket as proof of physical stock, allocation, or dispatch.
// Unknown statuses are blocked for human review, never sent into production.
const ACTIVE_YANDEX=new Set(['PROCESSING','PENDING','RESERVED']);
const TRANSIT_YANDEX=new Set(['DELIVERY','PICKUP']);
const HISTORY_YANDEX=new Set(['DELIVERED','CANCELLED']);
const HISTORY_OZON=new Set(['delivered','cancelled']);
const TRANSIT_OZON=new Set(['delivering']);
export function classifyOrderBucket(order){
 const source=order?.source;
 const value=typeof order?.source_status==='string'?order.source_status:
   typeof order?.sourceStatus==='string'?order.sourceStatus:null;
 const status=value?.trim();
 if(!status)return {bucket:'review',reason:'status_unverified',sewingAllowed:false};
 if(source==='manual'||['avito','plamya','dealer_ruslan','dealer_irina'].includes(source))
  return {bucket:'review',reason:'manual_status_requires_verification',sewingAllowed:false};
 if(source==='yandex'){
  // Unpaid orders are not confirmed customer obligations for sewing.
  if(status==='UNPAID')return {bucket:'review',reason:'payment_unverified',sewingAllowed:false};
  if(HISTORY_YANDEX.has(status))
   return {bucket:'history',reason:status==='CANCELLED'?'cancelled':'delivered',sewingAllowed:false};
  if(TRANSIT_YANDEX.has(status))
   return {bucket:'transit',reason:'in_delivery',sewingAllowed:false};
  if(ACTIVE_YANDEX.has(status))
   return {bucket:'active',reason:'needs_stock_and_sku_check',sewingAllowed:false};
 }
 if(source==='ozon_fbo'){
  if(HISTORY_OZON.has(status))
   return {bucket:'history',reason:status,sewingAllowed:false};
  if(TRANSIT_OZON.has(status))
   return {bucket:'transit',reason:'marketplace_delivery',sewingAllowed:false};
  // FBO is never a customer-order sewing queue.
  return {bucket:'review',reason:'fbo_no_direct_sewing',sewingAllowed:false};
 }
 if(source==='ozon'){
  if(HISTORY_OZON.has(status))
   return {bucket:'history',reason:status,sewingAllowed:false};
  if(TRANSIT_OZON.has(status))
   return {bucket:'transit',reason:'in_delivery',sewingAllowed:false};
  if(status==='awaiting_packaging')
   return {bucket:'active',reason:'needs_stock_and_sku_check',sewingAllowed:false};
 }
 if(source==='wb'){
  if(['cancel','cancelled','canceled','delivered'].includes(status.toLowerCase()))
   return {bucket:'history',reason:'finished_or_cancelled',sewingAllowed:false};
  if(status==='wb_in_delivery')return {bucket:'transit',reason:'in_delivery',sewingAllowed:false};
  if(status==='new_fbs_assembly_order'||status==='wb_confirmed_assembly')
   return {bucket:'active',reason:'needs_stock_and_sku_check',sewingAllowed:false};
 }
 return {bucket:'review',reason:'unrecognized_source_status',sewingAllowed:false};
}
export function bucketCounts(orders){
 const counts={active:0,transit:0,history:0,review:0};
 for(const order of orders)counts[classifyOrderBucket(order).bucket]++;
 return counts;
}
