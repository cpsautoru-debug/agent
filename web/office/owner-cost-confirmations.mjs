// Immutable owner confirmations applied to read-side cost evidence.
// The original D1 record is not edited or erased: Cloudflare D1 write
// permission is unavailable. A future authorized write should reconcile it.
export const OWNER_COST_DECISIONS=Object.freeze([Object.freeze({
 sku:'5023073005',
 sellerArticle:'веста кросс-оранжевая поддержка-оранжевые соты',
 costKopecks:450000,
 supersededAuxiliaryCostKopecks:470000,
 ownerConfirmedAt:'2026-11-24',
 source:'Owner explicitly confirmed 4500 RUB for Ozon SKU 5023073005 in ChatGPT'
})]);

// Accepts database snake_case records. For unexpected values, fail closed:
// do not silently overwrite later changes or an unrelated product.
export function applyOwnerConfirmedOzonCosts(rows){
 if(!Array.isArray(rows))throw Error('ozon_cost_source_invalid');
 const decisions=[];
 const effective=rows.map(row=>{
  const decision=OWNER_COST_DECISIONS.find(d=>d.sku===row?.sku&&
    d.sellerArticle===row?.seller_article);
  if(!decision)return row;
  if(row.cost_kopecks===decision.costKopecks){
   decisions.push({sku:decision.sku,status:'already_consistent',
    effectiveCostKopecks:decision.costKopecks,
    confirmedAt:decision.ownerConfirmedAt});
   return row;
  }
  if(row.status!=='confirmed'||
     row.cost_kopecks!==decision.supersededAuxiliaryCostKopecks){
   decisions.push({sku:decision.sku,status:'unexpected_source_value',
    effectiveCostKopecks:null,confirmedAt:decision.ownerConfirmedAt});
   return row;
  }
  decisions.push({sku:decision.sku,status:'owner_confirmation_applied_read_side',
   previousCostKopecks:row.cost_kopecks,
   effectiveCostKopecks:decision.costKopecks,
   confirmedAt:decision.ownerConfirmedAt});
  return {...row,cost_kopecks:decision.costKopecks,
   source:'OWNER_CONFIRMED_2026-11-24_SKU_5023073005'};
 });
 return {rows:effective,decisions};
}
