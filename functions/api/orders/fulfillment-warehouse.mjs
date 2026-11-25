const ENTITY = 'https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL = new Set(['avito', 'plamya', 'dealer_ruslan', 'dealer_irina']);
const MARKETPLACE = new Set(['ozon', 'wb', 'yandex']);
const STORE_KINDS = new Set(['manufacturer', 'retail', 'marketplace']);

function entityId(ref, type) {
 const prefix = ENTITY + type + '/';
 const href = ref?.meta?.href;
 const id = typeof href === 'string' && href.startsWith(prefix) ? href.slice(prefix.length) : '';
 return UUID.test(id) ? id.toLowerCase() : null;
}

function safeReadReason(error,entity){
 const code=error?.message||'';
 if(code==='ms_token_unavailable')return 'ms_token_unavailable';
 if(code==='ms_request_budget_exhausted')return 'ms_request_budget_exhausted';
 if(code==='ms_request_deadline')return 'ms_request_deadline';
 if(code==='ms_network_failure')return 'ms_network_failure';
 if(code==='ms_body_read_failed'||code==='ms_body_unavailable')return 'ms_body_read_failed';
 if(code==='ms_invalid_json')return 'ms_invalid_json';
 if(code==='ms_response_too_large')return 'ms_response_too_large';
 if(code==='ms_http_401'||code==='ms_http_403')return 'ms_authorization_denied';
 if(code==='ms_http_404')return entity+'_not_found';
 if(code==='ms_http_429')return 'ms_rate_limited';
 if(/^ms_http_5\\d\\d$/.test(code))return 'ms_upstream_unavailable';
 return entity+'_read_failed';
}

function matches(entity, id) {
 return typeof entity?.id === 'string' && entity.id.toLowerCase() === id &&
  typeof entity.name === 'string' && entity.name.trim().length > 0 && entity.name.length <= 250;
}

export async function readWarehouse(order, mapping, readEntity) {
 const blocked = reason => ({status: 'warehouse_unverified',reason});
 let storeId, organizationId, source, storeKind;
 try {
  if (MANUAL.has(order.source)) {
   const orderId = order.ms_customerorder_id?.toLowerCase();
   if (!UUID.test(orderId || '')) return blocked('customer_order_id_missing');
   let doc;
   try {doc=await readEntity('customerorder/' + orderId);}
   catch {return blocked('customer_order_read_failed');}
   if (doc?.id?.toLowerCase() !== orderId) return blocked('customer_order_identity_mismatch');
   storeId = entityId(doc.store, 'store');
   organizationId = entityId(doc.organization, 'organization');
   source = 'customerorder';
   storeKind = mapping?.store_id === storeId && STORE_KINDS.has(mapping.store_kind)
    ? mapping.store_kind : null;
  } else if (MARKETPLACE.has(order.source) && mapping && STORE_KINDS.has(mapping.store_kind)) {
   storeId = mapping.store_id?.toLowerCase();
   organizationId = mapping.organization_id?.toLowerCase();
   source = 'cabinet_mapping';
   storeKind = mapping.store_kind;
  } else return blocked('cabinet_route_missing');
  if (!UUID.test(storeId || '') || !UUID.test(organizationId || ''))
   return blocked('route_entity_id_invalid');
  // Separate calls retain safe failure stage. Do not expose API bodies, tokens,
  // names, or request URLs in the owner-visible diagnostic.
  let store,organization;
  try {store=await readEntity('store/' + storeId);}
  catch(error) {return blocked(safeReadReason(error,'store'));}
  if (!matches(store,storeId)||store.archived===true)
   return blocked('store_entity_mismatch');
  try {organization=await readEntity('organization/' + organizationId);}
  catch(error) {return blocked(safeReadReason(error,'organization'));}
  if (!matches(organization,organizationId)||organization.archived===true)
   return blocked('organization_entity_mismatch');
  return {
   status: 'warehouse_verified', storeId, storeName: store.name, storeKind,
   organizationId, organizationName: organization.name, source
  };
 } catch {
  return blocked('warehouse_validation_failed');
 }
}
