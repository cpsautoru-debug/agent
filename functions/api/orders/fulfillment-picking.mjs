// A partially covered order must never enter the packing preview.
export function buildPickingPreview(demand){
 const result={readOnly:true,approvedForDispatch:false,complete:false,orders:[],units:null};
 if(demand?.complete!==true||demand.readOnly!==true||demand.approvedForDispatch!==false||!Array.isArray(demand.rows))return result;
 const grouped=new Map();
 for(const row of demand.rows){
  if(!grouped.has(row.orderKey))grouped.set(row.orderKey,[]);
  grouped.get(row.orderKey).push(row);
 }
 for(const [orderKey,lines] of grouped){
  if(!lines.length||lines.some(x=>x.category!=='stock'||!Number.isSafeInteger(x.quantity)||x.quantity<=0||x.quantity!==x.ordered||!Number.isSafeInteger(x.lineIndex))||new Set(lines.map(x=>x.lineIndex)).size!==lines.length)continue;
  result.orders.push({orderKey,source:lines[0].source,items:lines.map(x=>({sku:x.sku,quantity:x.quantity})),units:lines.reduce((n,x)=>n+x.quantity,0)});
 }
 result.units=result.orders.reduce((n,x)=>n+x.units,0);
 result.complete=true;
 return result;
}
