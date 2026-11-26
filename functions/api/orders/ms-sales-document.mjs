// Pure document builders. No network calls, no production writes.
const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function ref(type,id){
 if(!UUID.test(id||''))throw Error('entity_unverified');
 return {meta:{href:ROOT+type+'/'+id,type,mediaType:'application/json'}};
}
function moment(value){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)||!Number.isFinite(Date.parse(value.replace(' ','T')+'Z')))throw Error('moment_unverified');
 return value;
}
export function buildCustomerOrder({key,source,scheme,createdAt,cutover,inventoryVerified,route,agentId,channelId,currency,lines,duplicate}){
 if(!['ozon','wb','yandex'].includes(source)||scheme!=='FBS'||typeof key!=='string'||!new RegExp('^AS63:'+source+':[A-Za-z0-9._-]{1,100}:[A-Za-z0-9._-]{1,100}$').test(key)||key.length>180)throw Error('identity_unverified');
 if(!inventoryVerified||moment(createdAt)<moment(cutover)||duplicate!=='not_found')throw Error('cutover_or_duplicate_unverified');
 if(!['manufacturer','retail'].includes(route?.store_kind)||currency!=='RUB')throw Error('route_or_currency_unverified');
 if(!Array.isArray(lines)||!lines.length||lines.length>50)throw Error('lines_unverified');
 const positions=lines.map(l=>{
  if(!['product','variant','bundle'].includes(l.type)||!Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>1000||!Number.isSafeInteger(l.priceMinor)||l.priceMinor<0)throw Error('line_unverified');
  return {assortment:ref(l.type,l.id),quantity:l.quantity,price:l.priceMinor};
 });
 return {externalCode:key,moment:createdAt,applicable:false,organization:ref('organization',route.organization_id),store:ref('store',route.store_id),agent:ref('counterparty',agentId),salesChannel:ref('saleschannel',channelId),positions};
}
export function buildDemand({order,orderId,shipmentKey,shipmentMoment,cutover,inventoryVerified,shipmentVerified,duplicate}){
 if(!inventoryVerified||!shipmentVerified||duplicate!=='not_found'||!UUID.test(orderId||'')||!order||typeof order.externalCode!=='string'||shipmentKey!==order.externalCode+':shipment'||moment(shipmentMoment)<moment(cutover)||shipmentMoment<order.moment)throw Error('shipment_unverified');
 // Only whole-order shipment; split shipments/returns require distinct evidence.
 return {externalCode:shipmentKey,moment:shipmentMoment,applicable:false,organization:order.organization,store:order.store,agent:order.agent,salesChannel:order.salesChannel,customerOrder:ref('customerorder',orderId),positions:order.positions.map(({assortment,quantity,price})=>({assortment,quantity,price}))};
}
