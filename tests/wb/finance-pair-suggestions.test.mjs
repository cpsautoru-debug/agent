import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestFinancePairs} from '../../web/office/finance-pair-suggestions.mjs';

test('shared model, kind and known details rank hints without verifying identity',()=>{
  const hints=suggestFinancePairs(
    ['чехлы веста черные соты'],
    [{sku:'oz1',name:'Авточехлы Lada Vesta черные соты'},
     {sku:'oz2',name:'Авточехлы Lada Vesta'}]
  );
  assert.equal(hints.length,2);
  assert.equal(hints[0].ozonSku,'oz1');
  assert.ok(hints[0].score>hints[1].score);
  assert.equal(hints[0].physicalIdentityVerified,false);
  assert.equal(hints[0].costTransferred,false);
  assert.equal(hints[0].reviewOnly,true);
});
test('model, product kind, color and fit conflicts are excluded',()=>{
  const hints=suggestFinancePairs(
    ['чехлы веста черные седан','карты_лада_веста_белые_соты'],
    [{sku:'cross',name:'Авточехлы Vesta Cross черные седан'},
     {sku:'wrongColor',name:'Авточехлы Vesta белые седан'},
     {sku:'wrongFit',name:'Авточехлы Vesta черные хэтчбек'},
     {sku:'wrongKind',name:'Авточехлы Vesta белые соты'}]
  );
  assert.equal(hints.length,0);
});
test('card title enriches hints but unknown attributes never imply equality',()=>{
  const hints=suggestFinancePairs(
    ['веста №2'],
    [{sku:'1',name:'Авточехлы Lada Vesta черные соты'}],
    new Map([['веста №2','Модельные авточехлы Lada Vesta']])
  );
  assert.equal(hints.length,1);
  assert.equal(hints[0].score,45);
  assert.ok(hints[0].missing.includes('color'));
  assert.equal(hints[0].physicalIdentityVerified,false);
});
test('unrecognized categories produce no candidates and malformed input fails',()=>{
  assert.deepEqual(suggestFinancePairs(
    ['коврики веста'],[{sku:'1',name:'коврики веста'}]),[]);
  assert.throws(()=>suggestFinancePairs(null,[]),/invalid/);
  assert.throws(()=>suggestFinancePairs([],[{sku:1,name:'авточехлы веста'}]),/invalid/);
});
