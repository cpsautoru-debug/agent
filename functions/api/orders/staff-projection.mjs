// Deny by default. Staff projections must never return raw queue rows or finance facts.
export const STAFF_ROLES=Object.freeze(['orders','sewing','cutting','packing','accounting','dispatch']);
export function staffProjection(role,data){
 if(!STAFF_ROLES.includes(role))throw Error('role_not_permitted');
 const orders=Array.isArray(data?.orders)?data.orders:[];
 const demand=data?.demand;
 const verified=demand?.complete===true&&demand.readOnly===true&&demand.approvedForDispatch===false&&Array.isArray(demand.rows);
 const basic=o=>({orderKey:o.order_key,source:o.source,items:o.items.map(i=>({sku:i.sku||i.name||i.itemId,quantity:i.quantity}))});
 let rows=[],complete=false;
 if(role==='orders'||role==='accounting'){
  rows=orders.filter(o=>o.queue_bucket==='active'||o.queue_bucket==='review').map(o=>({...basic(o),reason:o.queue_reason}));
  complete=data?.operationalQueueTruncated===false&&data?.coverageDiagnostics?.complete===true;
 }else if(role==='sewing'||role==='cutting'){
  rows=verified?demand.rows.filter(r=>r.category==='sewing'&&Number.isSafeInteger(r.quantity)&&r.quantity>0).map(r=>({orderKey:r.orderKey,sku:r.sku,quantity:r.quantity})):[];complete=verified;
 }else if(role==='packing'){
  const picking=data?.picking;
  complete=verified&&picking?.complete===true&&picking.readOnly===true&&picking.approvedForDispatch===false&&Array.isArray(picking.orders);
  rows=complete?picking.orders.map(o=>({orderKey:o.orderKey,source:o.source,items:o.items.map(i=>({sku:i.sku,quantity:i.quantity}))})):[];
 }else if(role==='dispatch'){
  rows=orders.filter(o=>o.source==='ozon'&&o.queue_reason==='awaiting_dispatch_no_sewing').map(basic);
  complete=false; // upstream status is not proof of physical handoff
 }
 return {role,rows,complete,readOnly:true,approvedForDispatch:false,approvedForProduction:false};
}
