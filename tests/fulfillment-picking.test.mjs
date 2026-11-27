import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPickingPreview} from '../functions/api/orders/fulfillment-picking.mjs';
const row=(orderKey,lineIndex,category='stock',quantity=1,ordered=1)=>({orderKey,source:'yandex',lineIndex,sku:'sku-'+lineIndex,category,quantity,ordered});
const demand=rows=>({complete:true,readOnly:true,approvedForDispatch:false,rows});
test('only whole stock-covered orders enter picking',()=>{const p=buildPickingPreview(demand([row('a',0),row('a',1),row('b',0),row('b',1,'sewing'),row('c',0,'stock',1,2),row('c',0,'production',1,2)]));assert.equal(p.complete,true);assert.equal(p.approvedForDispatch,false);assert.deepEqual(p.orders.map(o=>o.orderKey),['a']);assert.equal(p.units,2);});
test('incomplete demand blocks preview and does not report zero',()=>{const p=buildPickingPreview({...demand([row('a',0)]),complete:false});assert.equal(p.complete,false);assert.equal(p.units,null);assert.deepEqual(p.orders,[]);});
test('duplicate or inconsistent rows never enter picking',()=>{const p=buildPickingPreview(demand([row('a',0),row('a',0),row('b',0,'stock',0,0),row('c',0,'review',null,1)]));assert.equal(p.units,0);assert.deepEqual(p.orders,[]);});
