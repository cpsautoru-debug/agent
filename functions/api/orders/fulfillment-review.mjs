export function buildReview(warehouse,rows){
 return {warehouse,lines:rows.map(row=>({
  item:row.item,itemId:row.itemId,ordered:row.ordered,
  accounting:row.accounting??null,production:row.production??null,
  status:'requires_review',
  reason:!row.itemId?'item_mapping_unverified':
   warehouse.status!=='warehouse_verified'?'warehouse_unverified':
   row.accounting?.status!=='accounting_verified'?'availability_unverified':
   row.production?.status!=='production_verified'?'production_unverified':
   'competing_order_coverage_unverified',
  warehouseCovered:null,plannedCovered:null,missing:null
 }))};
}

export function saveReview(db,order,checkedAt,review){
 return db.prepare(`INSERT INTO office_order_fulfillment(order_key,source_checked_at,checked_at,result_json)
 SELECT order_key,source_checked_at,?,? FROM office_order_queue WHERE order_key=? AND source_checked_at=?
 ON CONFLICT(order_key) DO UPDATE SET source_checked_at=excluded.source_checked_at,
  checked_at=excluded.checked_at,result_json=excluded.result_json
 WHERE office_order_fulfillment.checked_at<excluded.checked_at
 AND (office_order_fulfillment.source_checked_at<>excluded.source_checked_at
   OR office_order_fulfillment.result_json<>excluded.result_json)`)
  .bind(checkedAt,JSON.stringify(review),order.order_key,order.source_checked_at).run();
}

export function readReviews(db){
 return db.prepare(`SELECT f.order_key,f.source_checked_at,f.checked_at,f.result_json
 FROM office_order_fulfillment f
 JOIN office_order_queue q ON q.order_key=f.order_key AND q.source_checked_at=f.source_checked_at
 JOIN office_order_queue_sync s ON s.source=q.source AND s.last_success_at=q.source_checked_at
 WHERE q.source_checked_at >= ?
 ORDER BY f.checked_at DESC LIMIT 150`)
  .bind(new Date(Date.now()-86400000).toISOString()).all();
}
