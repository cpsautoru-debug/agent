import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFinanceProductLabel,makeFinanceReviewGroups
} from '../../web/office/finance-link-review-groups.mjs';

test('classifies explicit seat covers separately from door inserts and floor mats',()=>{
  assert.deepEqual(classifyFinanceProductLabel(
    'Модельные авточехлы на Лада Приора/Lada Priora седан, черные с алькантарой'
  ),{
    key:'priora|seat',label:'Lada Priora · авточехлы',
    model:'priora',kind:'seat'
  });
  assert.deepEqual(classifyFinanceProductLabel(
    'карты_лада_веста_красные_соты'
  ),{
    key:'vesta|door',label:'Lada Vesta · дверные вставки',
    model:'vesta',kind:'door'
  });
  assert.deepEqual(classifyFinanceProductLabel(
    'Вставки в дверные карты для Lada Granta, черные соты'
  ),{
    key:'granta|door',label:'Lada Granta · дверные вставки',
    model:'granta',kind:'door'
  });
  assert.equal(classifyFinanceProductLabel('Коврики EVA Lada Vesta'),null);
  assert.equal(classifyFinanceProductLabel('подлокотник Lada Priora'),null);
  assert.equal(classifyFinanceProductLabel('веста №2'),null);
  assert.equal(classifyFinanceProductLabel('кроссворд'),null);
});
test('Vesta Cross never joins standard Vesta groups; no forced matches by name',()=>{
  assert.equal(classifyFinanceProductLabel('чехлы Lada Vesta Cross').key,'vesta-cross|seat');
  assert.equal(classifyFinanceProductLabel('чехлы Лада Веста').key,'vesta|seat');
  const wb=['чехлы веста черные соты','чехлы веста кросс черные',
    'карты_лада_веста_черные_соты','веста №2','коврики веста'];
  const ozon=[
    {sku:'1',name:'Модельные авточехлы на Lada Vesta черные соты'},
    {sku:'2',name:'Модельные авточехлы на Lada Vesta Cross черные'},
    {sku:'3',name:'Дверные вставки в дверные карты для Lada Vesta'},
    {sku:'4',name:'Коврики для Lada Vesta'},
  ];
  const found=makeFinanceReviewGroups(wb,ozon);
  assert.equal(found.groups.length,3);
  assert.equal(found.ambiguousWb,2);
  assert.equal(found.ambiguousOzon,1);
  assert.equal(found.changedRecords,0);
  assert.equal(found.physicalIdentityVerified,false);
  assert.equal(found.status,'model_and_kind_review_only');
  assert.deepEqual(found.groups.find(g=>g.key==='vesta-cross|seat').ozonSkus,['2']);
  assert.deepEqual(found.groups.find(g=>g.key==='vesta|door').ozonSkus,['3']);
  assert.deepEqual(found.groups.find(g=>g.key==='vesta|seat').wbArticles,
    ['чехлы веста черные соты']);
});
test('only groups with both marketplace sources are offered',()=>{
  const found=makeFinanceReviewGroups(
    ['чехлы приора','карты_лада_веста_белые_соты'],
    [{sku:'one',name:'чехлы Lada Vesta'}]
  );
  assert.equal(found.groups.length,0);
  assert.equal(found.linkedCount,0);
});
test('verified WB card title can classify previously ambiguous vendorCode but does not confirm identity',()=>{
  const matched=makeFinanceReviewGroups(
    ['веста №2','карты_лада_веста_красные_соты'],
    [{sku:'OZ-VESTA',name:'Модельные авточехлы Lada Vesta'}],
    new Map([['веста №2','Модельные авточехлы на Lada Vesta']])
  );
  assert.equal(matched.groups.length,1);
  assert.deepEqual(matched.groups[0].wbArticles,['веста №2']);
  assert.equal(matched.groups[0].physicalIdentityVerified,false);
  assert.equal(matched.changedRecords,0);
  assert.equal(matched.ambiguousWb,0);
});
test('input limits and malformed identities fail closed',()=>{
  assert.throws(()=>makeFinanceReviewGroups(null,[]),/invalid/);
  assert.throws(()=>makeFinanceReviewGroups([],Array(2001).fill({sku:'a',name:'ch'})),/invalid/);
  assert.throws(()=>makeFinanceReviewGroups([123],[]),/review_wb_invalid/);
  assert.throws(()=>makeFinanceReviewGroups([],[{sku:'1',name:null}]),/review_ozon_invalid/);
});
