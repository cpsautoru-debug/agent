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

function matches(entity, id) {
 return typeof entity?.id === 'string' && entity.id.toLowerCase() === id &&
  typeof entity.name === 'string' && entity.name.trim().length > 0 && entity.name.length <= 250;
}

export async function readWarehouse(order, mapping, readEntity) {
 const blocked = {status: 'warehouse_unverified'};
 let storeId, organizationId, source, storeKind;
 try {
  if (MANUAL.has(order.source)) {
   const orderId = order.ms_customerorder_id?.toLowerCase();
   if (!UUID.test(orderId || '')) return blocked;
   const doc = await readEntity('customerorder/' + orderId);
   if (doc?.id?.toLowerCase() !== orderId) return blocked;
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
  }
  if (!UUID.test(storeId || '') || !UUID.test(organizationId || '')) return blocked;
  const [store, organization] = await Promise.all([
   readEntity('store/' + storeId), readEntity('organization/' + organizationId)
  ]);
  if (!matches(store, storeId) || !matches(organization, organizationId) || store.archived === true ||
      organization.archived === true) return blocked;
  return {
   status: 'warehouse_verified', storeId, storeName: store.name, storeKind,
   organizationId, organizationName: organization.name, source
  };
 } catch {
  return blocked;
 }
}
