// Read-only evidence; no automatic approval or stock inference.
export async function catalogueCandidates(db,sku,now=Date.now()){
 if(!db||typeof sku!=='string'||!sku||sku.length>100)return null;
 const current=await db.prepare("SELECT c.generation,c.completed_at,c.row_count,s.started_at FROM ms_assortment_current c JOIN ms_assortment_scan s ON s.generation=c.generation WHERE c.singleton=1 AND s.status='complete' AND s.total=c.row_count AND s.next_offset=s.total").first();
 if(!current||!Number.isSafeInteger(current.row_count)||current.row_count<1||current.row_count>10000)return null;
 const start=Date.parse(current.started_at),end=Date.parse(current.completed_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>now||now-start>24*3600000)return null;
 const rows=(await db.prepare("SELECT item_id,item_type,item_json FROM ms_assortment_items WHERE generation=? AND (article=? OR code=? OR EXISTS (SELECT 1 FROM json_each(item_json,'$.barcodes') WHERE value=? AND type='text')) LIMIT 21").bind(current.generation,sku,sku,sku).all()).results;
 if(!Array.isArray(rows))return null;
 const candidates=[];
 for(const row of rows){
  const x=JSON.parse(row.item_json);
  if(x.id!==row.item_id||x.itemType!==row.item_type||typeof x.archived!=='boolean'||!Array.isArray(x.barcodes))return null;
  const fields=[...(x.article===sku?['article']:[]),...(x.code===sku?['code']:[]),...(x.barcodes.includes(sku)?['barcode']:[])];
  if(!fields.length)return null;
  candidates.push({id:x.id,type:x.itemType,name:x.name,archived:x.archived,matchFields:fields,characteristics:x.characteristics});
 }
 return {status:candidates.length===1&&!candidates[0].archived&&['product','variant','bundle'].includes(candidates[0].type)?'unique_candidate':candidates.length?'review':'no_exact_candidate',candidates,completedAt:current.completed_at,automaticApproval:false};
}
