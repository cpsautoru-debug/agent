// Pure accounting decision rules. No API writes. Unknown evidence blocks action.
export function reservationPlan(lines,inventoryVerified,coverageComplete){
 if(inventoryVerified!==true||coverageComplete!==true||!Array.isArray(lines)||!lines.length)throw Error('reservation_unverified');
 const seen=new Set();
 return lines.map(({itemId,ordered,reserved,free})=>{
  if(typeof itemId!=='string'||!itemId||seen.has(itemId)||![ordered,reserved,free].every(Number.isSafeInteger)||ordered<1||reserved<0||reserved>ordered||free<0)throw Error('reservation_line_unverified');
  seen.add(itemId);
  const reserve=Math.min(ordered-reserved,free);
  return {itemId,reserve,missing:ordered-reserved-reserve};
 });
}
export function cancellationPlan({cancelled,shipmentState,reservations}){
 if(cancelled!==true||shipmentState!=='not_shipped'||!Array.isArray(reservations)||reservations.some(r=>typeof r.itemId!=='string'||!Number.isSafeInteger(r.quantity)||r.quantity<0)||new Set(reservations.map(r=>r.itemId)).size!==reservations.length)throw Error('cancellation_unverified');
 return reservations.map(r=>({itemId:r.itemId,release:r.quantity}));
}
export function returnPlan({receiptVerified,duplicate,shipped,returned}){
 if(receiptVerified!==true||duplicate!=='not_found'||!Array.isArray(shipped)||!Array.isArray(returned)||!returned.length)throw Error('return_unverified');
 const seen=new Set();
 return returned.map(r=>{
  const matches=shipped.filter(s=>s.itemId===r.itemId);
  if(typeof r.itemId!=='string'||seen.has(r.itemId)||matches.length!==1||!Number.isSafeInteger(r.quantity)||r.quantity<1||!Number.isSafeInteger(matches[0].quantity)||!Number.isSafeInteger(matches[0].previouslyReturned)||matches[0].previouslyReturned<0||r.quantity>matches[0].quantity-matches[0].previouslyReturned)throw Error('return_quantity_unverified');
  seen.add(r.itemId);
  return {itemId:r.itemId,quantity:r.quantity};
 });
}
export function dealerBalance({openingMinor,mode,complete,events}){
 if(mode!=='sale'||complete!==true||!Number.isSafeInteger(openingMinor)||!Array.isArray(events))return {verified:false,balanceMinor:null};
 const seen=new Set();let total=openingMinor;
 for(const e of events){
  if(typeof e.id!=='string'||!e.id||seen.has(e.id)||e.verified!==true||!Number.isSafeInteger(e.amountMinor)||e.amountMinor<0||!['shipment','payment','return','refund'].includes(e.kind))return {verified:false,balanceMinor:null};
  seen.add(e.id);total+=['shipment','refund'].includes(e.kind)?e.amountMinor:-e.amountMinor;
  if(!Number.isSafeInteger(total))return {verified:false,balanceMinor:null};
 }
 return {verified:true,balanceMinor:total};
}
