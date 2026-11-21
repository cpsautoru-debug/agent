import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateBusinessOverheads,classifyCostCategory
} from '../../web/office/shared-overheads-core.mjs';
const month='2026-10';
const shares={wb:2500,ozon:4000,yandex:2000,avito:1000,offline:500};
const expenses=[
  {id:'pack-01',month,category:'packer_payroll',amountKopecks:10000000,
    source:'Ведомость зарплаты Ирины',includedInManufacturingCogs:false},
  {id:'rent-01',month,category:'rent',amountKopecks:5000000,
    source:'Арендная ведомость',includedInManufacturingCogs:false},
  {id:'garbage-01',month,category:'garbage_collection',amountKopecks:180101,
    source:'Договор и платёж мусор',includedInManufacturingCogs:false}
];
test('confirmed allocation exactly distributes packer, rent and garbage once',()=>{
  const result=allocateBusinessOverheads({
    month,expenses,allocation:{method:'confirmed_shares',shares,
      source:'Утверждённый ключ распределения 2026-10'}
  });
  const sum=expenses.reduce((n,x)=>n+x.amountKopecks,0);
  assert.equal(result.totalKopecks,sum);
  assert.equal(Object.values(result.channels).reduce((n,x)=>n+x,0),sum);
  assert.equal(result.channels.wb>0,true);
  assert.equal(result.channels.ozon>result.channels.wb,true);
  assert.deepEqual(result.excludedCategories,[
    'manufacturing_cost','advertising','tax']);
  assert.equal(result.status,'confirmed_allocation_not_tax_assessment');
});
test('unknown allocation, duplicate invoices, COGS wages and tax do not enter overhead',()=>{
  for(const wrong of [
    {method:'unallocated',shares,source:'budget'},
    {method:'confirmed_shares',shares:{...shares,wb:2501},source:'budget'},
    {method:'confirmed_shares',shares,source:''}
  ])assert.throws(()=>allocateBusinessOverheads({
    month,expenses,allocation:wrong
  }));
  for(const bad of [
    [...expenses,expenses[0]],
    [...expenses,{...expenses[0],id:'sewing',category:'seamstress_payroll'}],
    [...expenses,{...expenses[0],id:'tax',category:'tax'}],
    [...expenses,{...expenses[0],id:'double',includedInManufacturingCogs:true}]
  ])assert.throws(()=>allocateBusinessOverheads({
    month,expenses:bad,allocation:{method:'confirmed_shares',shares,source:'budget'}
  }));
  assert.equal(classifyCostCategory('seamstress_payroll'),'manufacturing_cogs');
  assert.equal(classifyCostCategory('cutter_payroll'),'manufacturing_cogs');
  assert.equal(classifyCostCategory('packer_payroll'),'shared_overhead');
  assert.equal(classifyCostCategory('manager_payroll'),'shared_overhead');
  assert.equal(classifyCostCategory('advertising'),'direct_advertising');
  assert.equal(classifyCostCategory('tax'),'entity_tax');
});
