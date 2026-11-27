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
 let nameLeads=[];
 if(!candidates.length){
  const r=(await db.prepare("SELECT item_id,item_type,item_json FROM ms_assortment_items WHERE generation=? AND item_type IN ('product','variant','bundle') AND json_extract(item_json,'$.archived')=0 AND (instr(json_extract(item_json,'$.name'),'Чехл')>0 OR instr(json_extract(item_json,'$.name'),'чехл')>0) LIMIT 1001").bind(current.generation).all()).results;
  if(Array.isArray(r)&&r.length<=1000){
   const parsed=r.map(row=>JSON.parse(row.item_json));
   nameLeads=catalogueNameLeads(sku,parsed);
  }
 }
 return {nameLeads,status:candidates.length===1&&!candidates[0].archived&&['product','variant','bundle'].includes(candidates[0].type)?'unique_candidate':candidates.length?'review':'no_exact_candidate',candidates,completedAt:current.completed_at,automaticApproval:false};
}

// Name leads are deliberately separate from exact identity evidence.
export function catalogueNameLeads(sku,items){
 const norm=x=>String(x||'').toLowerCase().replace(/ё/g,'е').replace(/алькантара|алька/g,'алька').replace(/\bcross\b|кросс/g,'кросс').replace(/vesta|веста/g,'веста').replace(/priora|приора/g,'приора');
 const tokens=x=>new Set(norm(x).split(/[^a-zа-я0-9]+/u).filter(Boolean));
 const query=tokens(sku), models=['веста','приора','гранта','нива','creta','rio','solaris','iskra'];
 const model=models.find(m=>query.has(m));if(!model)return [];
 const features=['кросс','алька','соты','квадрат','ромб','перфорация','седан','сд','хб'];
 const requested=features.filter(t=>query.has(t));
 return items.filter(x=>x.archived===false&&['product','variant','bundle'].includes(x.itemType)&&typeof x.name==='string'&&/чехл/i.test(x.name)&&!/крой|центра|лекал|материал|образец/i.test(x.name)).map(x=>{
 const t=tokens(x.name);if(!t.has(model)||requested.some(k=>!t.has(k)))return null;
 const matched=[...query].filter(k=>t.has(k));
 if(matched.length<2)return null;
 return {id:x.id,type:x.itemType,name:x.name,code:x.code,matchedTokens:matched,automaticApproval:false};
 }).filter(Boolean).sort((a,b)=>b.matchedTokens.length-a.matchedTokens.length||a.name.localeCompare(b.name,'ru')).slice(0,5);
}
