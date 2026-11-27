import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDemand} from '../functions/api/orders/fulfillment-demand.mjs';
const now=Date.parse('2026-11-27T05:00:00Z');
const o={order_key:'AS63:yandex:123:456',source:'yandex',queue_bucket:'active',items:[{sku:'vesta',quantity:3}]};
const r={orderKey:o.order_key,checkedAt:new Date(now).toISOString(),warehouse:{status:'warehouse_verified'},lines:[{key:o.order_key+':line:0',ordered:3,status:'sewing_required',warehouseCovered:1,plannedCovered:1,missing:1}]};
const c={complete:true};
test('mixed allocation splits without counting a unit twice',()=>{const d=buildDemand([o],[r],c,{now});assert.deepEqual(d.counts,{stock:1,production:1,sewing:1,review:0});assert.equal(d.complete,true);assert.equal(d.approvedForDispatch,false);});
test('incomplete sources, truncated view, stale or missing review fail closed',()=>{for(const [reviews,coverage,opts] of [[[r],{complete:false},{}],[[r],c,{truncated:true}],[[r],c,{now:now+31*60000}],[[],c,{}]]){const d=buildDemand([o],reviews,coverage,{now,...opts});assert.equal(d.complete,false);assert.equal(d.rows[0].quantity,null);assert.equal(d.rows[0].category,'review');}});
test('inconsistent quantities or order identity fail closed',()=>{for(const l of [{...r.lines[0],missing:2},{...r.lines[0],key:'wrong'}])assert.equal(buildDemand([o],[{...r,lines:[l]}],c,{now}).rows[0].category,'review');});
test('FBO and historical orders excluded',()=>{assert.equal(buildDemand([{...o,source:'ozon_fbo'},{...o,queue_bucket:'history'},{...o,queue_bucket:'transit'}],[r],c,{now}).rows.length,0);});

test('operational priority orders categories before stable order identity; no invented deadline',()=>{const unknown={...o,order_key:'AS63:yandex:123:001',queue_bucket:'review'};const d=buildDemand([unknown,o],[r],c,{now});assert.deepEqual(d.rows.map(x=>x.category),['stock','production','sewing','review']);assert.deepEqual(d.rows.map(x=>x.priority),[1,2,3,4]);assert.ok(d.rows.every(x=>x.deadline===null));assert.equal(d.approvedForDispatch,false);});
