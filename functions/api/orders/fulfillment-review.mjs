export function buildReview(warehouse,rows,allocation=null){
 const proved=allocation?.status==='calculated'&&Array.isArray(allocation.lines);
 const allocations=new Map(proved?allocation.lines.map(x=>[x.key,x]):[]);
 // Fail closed: callers must provide a complete cohort allocation, never an
 // isolated-order estimate from informational stock or production evidence.
 const complete=proved&&allocations.size===rows.length&&
  rows.every(row=>typeof row.key==='string'&&allocations.has(row.key));
 return {warehouse,lines:rows.map(row=>{
  const verified=complete?allocations.get(row.key):null;
  const valid=verified&&verified.itemId===row.itemId&&
    Number.isSafeInteger(verified.warehouseCovered)&&verified.warehouseCovered>=0&&
    Number.isSafeInteger(verified.plannedCovered)&&verified.plannedCovered>=0&&
    Number.isSafeInteger(verified.missing)&&verified.missing>=0&&
    verified.warehouseCovered+verified.plannedCovered+verified.missing===row.ordered;
  return {
   key:row.key??null,item:row.item,itemId:row.itemId,ordered:row.ordered,
   accounting:row.accounting??null,production:row.production??null,
   occupancy:row.occupancy??null,
   status:valid?(verified.missing>0?'sewing_required':
     verified.plannedCovered>0?'production_covered':'warehouse_covered'):'requires_review',
   reason:valid?null:
    !row.itemId?'item_mapping_unverified':
    warehouse.status!=='warehouse_verified'?'warehouse_unverified':
    row.accounting?.status!=='accounting_verified'?'availability_unverified':
    row.occupancy?.status!=='warehouse_orders_verified'?'competing_order_coverage_unverified':
    row.production?.status!=='production_verified'?'production_unverified':
    'marketplace_coverage_unverified',
   warehouseCovered:valid?verified.warehouseCovered:null,
   plannedCovered:valid?verified.plannedCovered:null,
   missing:valid?verified.missing:null,
   ...(valid?{productionTaskIds:verified.productionTaskIds}: {})
  };
 })};
}

export function saveReview(db,order,checkedAt,review){
 return db.prepare(`INSERT INTO office_order_fulfillment(order_key,source_checked_at,checked_at,result_json)
 SELECT order_key,source_checked_at,?,? FROM office_order_queue WHERE order_key=? AND source_checked_at=?
 ON CONFLICT(order_key) DO UPDATE SET source_checked_at=excluded.source_checked_at,
  checked_at=excluded.checked_at,result_json=excluded.result_json
 WHERE office_order_fulfillment.checked_at<excluded.checked_at`)
  .bind(checkedAt,JSON.stringify(review),order.order_key,order.source_checked_at).run();
}

export function readReviews(db,orderKeys=null){
 if(orderKeys?.length===0)return Promise.resolve({results:[]});
 const scoped=orderKeys!==null;
 return db.prepare(`SELECT f.order_key,f.source_checked_at,f.checked_at,f.result_json
 FROM ${scoped?"json_each(?) keys CROSS JOIN office_order_fulfillment f ON f.order_key=keys.value":
  "office_order_fulfillment f"}
 JOIN office_order_queue q ON q.order_key=f.order_key AND q.source_checked_at=f.source_checked_at
 JOIN office_order_queue_sync s ON s.source=CASE WHEN q.source IN ('avito','plamya','dealer_ruslan','dealer_irina') THEN 'manual' ELSE q.source END AND s.last_success_at=q.source_checked_at
 WHERE q.source_checked_at >= ?
 ORDER BY f.checked_at DESC LIMIT 150`)
  .bind(...(scoped?[JSON.stringify(orderKeys)]:[]),new Date(Date.now()-86400000).toISOString()).all();
}
