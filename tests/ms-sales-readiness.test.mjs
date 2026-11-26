import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSalesReadiness,createMsSalesReadiness} from '../functions/api/orders/ms-sales-readiness.js';
const now=Date.parse('2026-11-26T08:00:00Z'),stamp=new Date(now).toISOString();
const id='7d3da55a-760f-11f1-0a80-066a00250941';
const order={order_key:'AS63:ozon:171189:123',source:'ozon',account:'171189',source_status:'awaiting_packaging',production_disposition:'candidate_needs_inventory',source_checked_at:stamp,items_json:JSON.stringify([{sku:'100013',quantity:1}])};
const route={store_id:id,organization_id:id,store_kind:'manufacturer'};
const links=[{marketplace_sku:'100013',ms_item_id:id,ms_item_type:'product'}];
test('even fully mapped fresh orders cannot write without transaction and cutover evidence',()=>{
 const r=assessSalesReadiness(order,route,links,stamp,'not_found',now);
 assert.equal(r.readyToWrite,false);
 assert.deepEqual(r.missingSkus,[]);
 assert.deepEqual(r.blockers,['source_transaction_date_price_currency_unverified','counterparty_channel_unverified','cutover_inventory_unverified']);
});
test('duplicate, stale, missing mapping and warehouse block',()=>{
 const r=assessSalesReadiness(order,null,[],null,'already_exists',now);
 for(const b of ['existing_document','stale_snapshot','sku_unverified','warehouse_route_unverified'])assert.ok(r.blockers.includes(b));
});
test('historical orders and FBO-like Yandex disposition do not become sales candidates',()=>{
 for(const o of [{...order,source_status:'delivered'},{...order,source:'yandex',source_status:'PROCESSING',production_disposition:'not_for_sewing'}]){
  assert.ok(assessSalesReadiness(o,route,links,stamp,'not_found',now).blockers.includes('not_confirmed_fbs_candidate'));
 }
});
test('POST is prohibited',async()=>{
 const res=await createMsSalesReadiness()({request:new Request('https://autosklad63-office-staging.pages.dev/api/orders/ms-sales-readiness',{method:'POST'}),env:{}});
 assert.equal(res.status,405);
 assert.equal((await res.json()).changedMoySkladRecords,0);
});
