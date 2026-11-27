// Read-only projection of saved reviews. Never issue production tasks.
export function buildDemand(orders,reviews,coverage,{now=Date.now(),truncated=false}={}){
 const byOrder=new Map(reviews.map(r=>[r.orderKey,r]));
 const rows=[];
 for(const o of orders){
  if(o.source==='ozon_fbo'||!['active','review'].includes(o.queue_bucket))continue;
  const r=byOrder.get(o.order_key),age=now-Date.parse(r?.checkedAt||'');
  const valid=coverage?.complete===true&&!truncated&&o.queue_bucket==='active'&&age>=0&&age<=30*60000&&r?.warehouse?.status==='warehouse_verified'&&Array.isArray(r.lines)&&r.lines.length===o.items.length&&r.lines.every((l,i)=>l.key===o.order_key+':line:'+i&&l.ordered===o.items[i].quantity&&['warehouse_covered','production_covered','sewing_required'].includes(l.status)&&[l.warehouseCovered,l.plannedCovered,l.missing].every(n=>Number.isSafeInteger(n)&&n>=0)&&l.warehouseCovered+l.plannedCovered+l.missing===l.ordered);
  for(const [i,item] of o.items.entries()){
   const base={orderKey:o.order_key,source:o.source,lineIndex:i,sku:item.sku||item.name||item.itemId,ordered:item.quantity};
   if(!valid){rows.push({...base,category:'review',quantity:null,reason:o.queue_bucket==='review'?o.queue_reason:coverage?.complete!==true?'marketplace_coverage_unverified':'allocation_unverified'});continue;}
   const l=r.lines[i];
   for(const [category,quantity] of [['stock',l.warehouseCovered],['production',l.plannedCovered],['sewing',l.missing]])if(quantity>0)rows.push({...base,category,quantity,reason:null});
  }
 }
 const counts={stock:0,production:0,sewing:0,review:0};
 for(const r of rows)counts[r.category]+=r.category==='review'?1:r.quantity;
 return {rows,counts,complete:coverage?.complete===true&&!truncated&&!rows.some(r=>r.category==='review'),readOnly:true,approvedForDispatch:false,scope:'displayed_order_snapshot_only'};
}
