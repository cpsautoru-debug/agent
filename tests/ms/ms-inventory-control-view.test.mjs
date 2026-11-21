import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMeterUnit,classifyInventory,LOW_MATERIAL_METERS,checkInventoryPage,
  inventoryRows,summarizeInventory,unitTotals
} from '../../web/office/ms-inventory-control-view.mjs';

const sample=[
  {name:'Чёрная экокожа 0,8',code:'728562135',uom:'м',
   catalogPath:'Производство/Экокожа и алька',
   stores:[
     {name:'Основной склад',stock:39.9,reserve:3,inTransit:2},
     {name:'Внешний склад',stock:40,reserve:0,inTransit:0}
   ]},
  {name:'Pegas 0,8',code:'P2',uom:'п.м',catalogPath:'Производство/Экокожа и алька',
   stores:[{name:'Внешний склад',stock:0,reserve:0,inTransit:null}]},
  {name:'Крой Vesta Cross',code:'CUTVC',uom:'компл',
   catalogPath:'Производство/Крой',stores:[
     {name:'Основной склад',stock:12,reserve:0,inTransit:0}
   ]},
  {name:'Комплект авточехлов Vesta Cross',code:'READYVC',uom:'шт',
   catalogPath:'Производство/Готовая продукция',
   stores:[{name:'Основной склад',stock:8,reserve:2,inTransit:0}]},
  {name:'Подлокотник Vesta',code:'OTHER',uom:'шт',
   catalogPath:'Продажа/Автотовары',stores:[
     {name:'Основной склад',stock:25,reserve:0,inTransit:0}
   ]},
  {name:'Заготовка без группы',code:null,uom:'м',
   catalogPath:null,stores:[]}
];
function page(offset,items,total=sample.length){
  return {
    code:'ms_stock_bystore_ok',
    source:'MOYSKLAD_STOCK_BYSTORE_AND_ASSORTMENT',
    scope:'PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY',
    readOnly:true,changedRecords:0,totalAssortmentReportRows:total,
    pageSize:10,offset,items,hasMore:offset+items.length<total&&offset<4990,
    namesResolved:items.filter(x=>x.name!==null).length
  };
}
test('strictly less than 40 metres per store; do not sum external+main balances',()=>{
  assert.equal(LOW_MATERIAL_METERS,40);
  const low=inventoryRows(sample,'all','','low');
  assert.deepEqual(low.map(x=>[x.name,x.warehouse,x.stock]),[
    ['Чёрная экокожа 0,8','Основной склад',39.9],
    ['Pegas 0,8','Внешний склад',0]
  ]);
  assert.equal(inventoryRows(sample,'Внешний склад','','low').length,1);
  assert.equal(inventoryRows(sample,'Основной склад','','low').length,1);
  assert.equal(inventoryRows(sample,'all','','low').some(x=>x.name==='Крой Vesta Cross'),false);
  assert.equal(isMeterUnit('м'),true);
  assert.equal(isMeterUnit('п.м.'),true);
  assert.equal(isMeterUnit('метр'),true);
  assert.equal(isMeterUnit('шт'),false);
  assert.equal(isMeterUnit(null),false);
});
test('classify only confirmed folder evidence, never based on vague name',()=>{
  assert.deepEqual(sample.map(classifyInventory),[
    'materials','materials','cut','finished','excluded','excluded'
  ]);
  assert.equal(classifyInventory({
    name:'Готовая продукция Vesta',catalogPath:'Продажа/Накидки'
  }),'excluded');
  assert.equal(classifyInventory({
    name:'Крой Priora',catalogPath:null
  }),'excluded');
  assert.equal(classifyInventory({
    name:'Крой Vesta',catalogPath:'Производство/Крой',
    uom:'м'
  }),'cut');
});
test('ready stock and cut only count real item/store rows and unit groups',()=>{
  const ready=inventoryRows(sample,'all','','finished');
  assert.equal(ready.length,1);
  assert.equal(ready[0].stock,8);
  assert.deepEqual(unitTotals(ready),[['шт',8]]);
  assert.deepEqual(unitTotals(inventoryRows(sample,'all','','cut')),
    [['компл',12]]);
  assert.equal(inventoryRows(sample,'all','Vesta','all').length,2);
  const all=inventoryRows(sample);
  assert.equal(all.length,5);
  assert.equal(all.some(x=>x.name==='Заготовка без группы'),false);
  assert.equal(all.some(x=>x.name==='Подлокотник Vesta'),false);
  assert.equal(all.find(x=>x.name==='Комплект авточехлов Vesta Cross').reserve,2);
});
test('status distinguishes partial inventory from completed page traversal',()=>{
  const a=summarizeInventory(sample,6,10);
  assert.equal(a.complete,false);
  assert.equal(a.counts.low,2);
  assert.equal(a.categories.materials,2);
  assert.equal(a.categories.cut,1);
  assert.equal(a.categories.finished,1);
  assert.equal(a.categories.unverified,0);
  assert.equal(a.productionItems,4);
  assert.equal(a.hiddenOtherItems,2);
  assert.ok(a.warehouses.includes('Основной склад'));
  assert.ok(a.warehouses.includes('Внешний склад'));
  const done=summarizeInventory(sample,6,6);
  assert.equal(done.complete,true);
  assert.equal(done.scope,'LOADED_ASSORTMENT_ROWS_NOT_PHYSICAL_INVENTORY');
  assert.throws(()=>summarizeInventory(sample,6,5));
});
test('a page is read only, exact numbered and bounded, with no false complete',()=>{
  assert.deepEqual(checkInventoryPage(page(0,sample),0).items,sample);
  for(const bad of [
    {...page(0,sample),changedRecords:1},
    {...page(0,sample),readOnly:false},
    {...page(0,sample),scope:'COMPLETE_INVENTORY'},
    {...page(0,sample),totalAssortmentReportRows:15},
    {...page(0,sample),offset:10},
    {...page(0,sample),hasMore:true},
    {...page(0,sample),items:[{...sample[0],stores:[{name:'Основной склад',stock:'40'}]}]},
    {...page(0,sample),items:[{...sample[0],stores:[{name:'Основной склад',stock:Infinity}]}]},
    {...page(0,sample),items:[{...sample[0],stores:[{name:'A',stock:1},{name:'A',stock:2}]}]},
    {...page(0,sample),items:[{...sample[0],name:'\nmalicious'}]}
  ])assert.throws(()=>checkInventoryPage(bad,0));
  assert.throws(()=>checkInventoryPage(page(0,sample),10));
  assert.throws(()=>checkInventoryPage(page(0,sample),-10));
});
test('unknown quantity, negative meter stock and absent warehouse are explicit',()=>{
  const lines=[
    {name:'Pegas',uom:'м',catalogPath:'Производство/Экокожа и алька',
      stores:[{name:'Основной склад',stock:-0.8,reserve:null,inTransit:null}]},
    {name:'Кожа с неизвестным остатком',uom:'м',
      catalogPath:'Производство/Экокожа и алька',
      stores:[{name:'Внешний склад',stock:null,reserve:null,inTransit:null}]},
    {name:'Чехлы без группы',uom:'шт',catalogPath:'',stores:[]}
  ];
  const rows=inventoryRows(lines);
  assert.equal(rows.filter(x=>x.low).length,0);
  assert.equal(rows.filter(x=>x.negative).length,1);
  assert.equal(rows.filter(x=>x.stock===null).length,2);
  assert.equal(inventoryRows(lines,'all','','negative').length,1);
  assert.equal(inventoryRows(lines,'all','','low').length,0);
  assert.throws(()=>inventoryRows(lines,'all','','DROP TABLE'));
});
