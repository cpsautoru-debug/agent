import test from 'node:test';
import assert from 'node:assert/strict';
import {manualOrderChannel} from '../functions/api/ms/manual-orders-preview.js';
test('dealer reference with internal space is accepted',()=>{
 assert.deepEqual(manualOrderChannel('AS63:manual:dealer_irina:IR 111234'),{key:'dealer_irina',label:'Дилер · Ирина',orderRef:'IR 111234'});
});
test('invalid external references remain rejected',()=>{
 for(const suffix of [' IR','IR ','IR  123','IR\n123','IR:123','IR/123','', 'X'.repeat(65)])assert.equal(manualOrderChannel('AS63:manual:dealer_irina:'+suffix),null);
});
