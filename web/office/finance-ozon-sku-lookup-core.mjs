// Pure helpers: derive read-only, exact SKU lookup candidates from an existing
// versioned Ozon Profit document and the separate auxiliary product catalog.
// The only acceptable lookup identifiers are decimal Ozon SKU strings.
const validSku=s=>typeof s==='string'&&/^[1-9][0-9]{0,17}$/.test(s);
const validText=(s,max)=>typeof s==='string'&&s.trim().length>0&&
  s.trim()===s&&s.length<=max&&
  !/[\u0000-\u001f\u007f]/u.test(s);
export function deriveOzonProfitMissingSkus(profit,catalog,max=100){
  if(!Array.isArray(profit)||profit.length>2000||
    !Array.isArray(catalog)||catalog.length>5000||
    !Number.isSafeInteger(max)||max<1||max>100)
    throw Error('ozon_sku_sources_invalid');
  const known=new Set();
  for(const x of catalog){
    if(typeof x?.sku!=='string'||!x.sku||known.has(x.sku))
      throw Error('ozon_sku_catalog_invalid');
    known.add(x.sku);
  }
  const source=new Set();
  for(const x of profit){
    if(typeof x?.sku!=='string'||!x.sku||x.sku.length>150)
      throw Error('ozon_profit_sku_invalid');
    source.add(x.sku);
  }
  const missing=[...source].filter(sku=>!known.has(sku)).sort(
    (a,b)=>a.localeCompare(b,'en')
  );
  if(missing.length>max)throw Error('ozon_sku_lookup_limit');
  const numeric=missing.filter(validSku);
  const unsupported=missing.filter(s=>!validSku(s));
  return {profitUniqueCount:source.size,
    missingCount:missing.length,skus:numeric,
    unsupported,skippedNonNumeric:unsupported.length};
}
export function validateOzonSellerProductInfo(data,requestedSkus){
  if(!Array.isArray(requestedSkus)||requestedSkus.length>100||
    requestedSkus.some(s=>!validSku(s))||
    new Set(requestedSkus).size!==requestedSkus.length||
    !data||!Array.isArray(data.items)||data.items.length>1000)
    throw Error('ozon_seller_products_invalid');
  const wanted=new Set(requestedSkus);
  const found=new Map();
  for(const x of data.items){
    // Ozon SKU is a number in the Seller API response, string in Profit.
    const sku=String(x?.sku??'');
    if(!wanted.has(sku))continue;
    const name=typeof x.name==='string'?x.name.trim():'';
    const offer=typeof x.offer_id==='string'?x.offer_id.trim():'';
    if(!validText(name,500)||!validText(offer,250)||
      found.has(sku))
      throw Error('ozon_seller_products_invalid');
    found.set(sku,{
      sku,name,offerId:offer,
      productId:Number.isSafeInteger(x.id)&&x.id>0?x.id:null,
      archived:x.is_archived===true,
      source:'ozon_seller_api_current_catalog',
      physicalIdentityVerified:false,costTransferred:false
    });
  }
  return {
    items:[...found.values()].sort((a,b)=>
      a.sku.localeCompare(b.sku,'en')),
    notFound:requestedSkus.filter(s=>!found.has(s)),
    foundCount:found.size
  };
}
