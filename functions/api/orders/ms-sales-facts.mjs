const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function minor(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 const s=String(value);
 if(!/^\d{1,10}(\.\d{1,2}0*|\.0+)?$/.test(s))return null;
 const [whole,fraction='']=s.split('.');
 const n=Number(whole)*100+Number((fraction+'00').slice(0,2));
 return Number.isSafeInteger(n)?n:null;
}
export function iso(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))return null;
 return new Date(value).toISOString();
}
export function currency(value){return value==='RUB'||value==='RUR'||value===643?'RUB':null;}
export function msRef(value,type){
 const prefix='https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/';
 const href=value?.meta?.href;
 const id=typeof href==='string'&&href.startsWith(prefix)?href.slice(prefix.length):'';
 return UUID.test(id)?id.toLowerCase():null;
}
export function marketplaceLineFacts(source,p){
 if(source==='wb')return {amountMinor:Number.isSafeInteger(p.price)&&p.price>=0?p.price:null,currency:currency(p.currencyCode),basis:'wb_order_price_minor'};
 return {amountMinor:minor(p.price),currency:currency(p.currency_code),basis:'ozon_posting_product_price'};
}
export function yandexLineFacts(item){
 const payment=item.prices?.payment;
 return {amountMinor:minor(payment?.value),currency:currency(payment?.currencyId),basis:'yandex_buyer_line_total'};
}
export function cleanLineFacts(f){
 if(!f||!['wb_order_price_minor','ozon_posting_product_price','yandex_buyer_line_total','ms_position_unit_price'].includes(f.basis))return null;
 return {basis:f.basis,amountMinor:Number.isSafeInteger(f.amountMinor)&&f.amountMinor>=0?f.amountMinor:null,currency:currency(f.currency)};
}
export function cleanOrderFacts(f){
 if(!f)return null;
 const id=x=>UUID.test(x||'')?x.toLowerCase():null;
 return {scheme:['FBS','FBO','FBY','DBS','EXPRESS','LAAS','manual'].includes(f.scheme)?f.scheme:null,
  createdAt:iso(f.createdAt),processingAt:iso(f.processingAt),updatedAt:iso(f.updatedAt),
  documentMoment:typeof f.documentMoment==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(f.documentMoment)?f.documentMoment:null,
  agentId:id(f.agentId),organizationId:id(f.organizationId),storeId:id(f.storeId),channelId:id(f.channelId),documentId:id(f.documentId)};
}
