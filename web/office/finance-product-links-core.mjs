const goodText=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&
  x.trim()===x&&!/[\u0000-\u001f\u007f]/u.test(x);
const isoDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
// Confirmed physical identity is more demanding than matching a car model.
// Never infer same part from a similar seller article, material or cost.
export function validateFinanceProductLinkDraft(d){
  if(!d||typeof d!=='object'||Array.isArray(d)||
    !goodText(d.wbVendorCode,200)||!goodText(d.ozonSku,150)||
    !isoDay(d.verifiedFrom)||
    !goodText(d.evidence,500)||d.evidence.length<15||
    d.identicalPhysicalProduct!==true||
    d.noAutomaticCostTransfer!==true)
    throw Error('finance_product_link_invalid');
  return {
    wbVendorCode:d.wbVendorCode,ozonSku:d.ozonSku,
    verifiedFrom:d.verifiedFrom,evidence:d.evidence,
    identicalPhysicalProduct:true,noAutomaticCostTransfer:true
  };
}
export function validatedFinanceProductLinkRead(rows){
  if(!Array.isArray(rows)||rows.length>500)throw Error('link_catalog_incomplete');
  const wb=new Set(),ozon=new Set();
  return rows.map(x=>{
    if(!goodText(x.wb_vendor_code,200)||
      !goodText(x.ozon_sku,150)||
      !goodText(x.ozon_seller_article,250)||
      !goodText(x.model_name,100)||!isoDay(x.verified_from)||
      !goodText(x.evidence,500)||!goodText(x.actor,250)||
      wb.has(x.wb_vendor_code)||ozon.has(x.ozon_sku))
      throw Error('link_catalog_invalid');
    wb.add(x.wb_vendor_code);ozon.add(x.ozon_sku);
    return {
      wbVendorCode:x.wb_vendor_code,ozonSku:x.ozon_sku,
      ozonSellerArticle:x.ozon_seller_article,
      modelName:x.model_name,verifiedFrom:x.verified_from,
      evidence:x.evidence,status:'verified_identity_only',
      costTransferred:false
    };
  });
}
