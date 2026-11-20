import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageWarehouseNames,selectStockPageGroups,summarizeStockPageGroups
} from '../../web/office/ms-stock-page-view.mjs';

const entries=[
  {name:'Дверная карта Vesta',uom:null,stores:[
    {name:'Основной склад (Цех)',stock:3,reserve:0,inTransit:0},
    {name:'Пламя. Магазин',stock:0,reserve:0,inTransit:0},
    {name:'Склад ЕВА',stock:0,reserve:0,inTransit:0},
    {name:'Склад материалов — внешний',stock:0,reserve:0,inTransit:0}
  ]},
  {name:'Материал',uom:'м',stores:[
    {name:'Основной склад (Цех)',stock:-0.8,reserve:0,inTransit:null},
    {name:'Склад материалов — внешний',stock:41.5,reserve:null,inTransit:2}
  ]},
  {name:'Без складских данных',uom:null,stores:[]}
];

test('warehouse choices originate exclusively from received page',()=>{
  assert.deepEqual(pageWarehouseNames(entries),[
    'Основной склад (Цех)','Пламя. Магазин','Склад ЕВА','Склад материалов — внешний'
  ]);
});

test('show all keeps each SKU once with all its warehouses and unknowns',()=>{
  const selected=selectStockPageGroups(entries,'');
  assert.equal(selected.length,3);
  assert.equal(selected[0].stores.length,4);
  assert.equal(selected[2].stores.length,0);
  const status=summarizeStockPageGroups(selected);
  assert.deepEqual(status,{
    positions:3,negative:1,unknown:1,zero:3,visibleStoreRows:6
  });
  assert.equal(entries[0].stores.length,4);
});

test('warehouse filter uses only page rows without additional reads or made-up zeros',()=>{
  const matching=selectStockPageGroups(entries,'Склад материалов — внешний');
  assert.equal(matching.length,2);
  assert.equal(matching[0].stores.length,1);
  assert.equal(matching[0].stores[0].stock,0);
  assert.equal(matching[1].stores[0].stock,41.5);
  const summary=summarizeStockPageGroups(matching);
  assert.deepEqual(summary,{
    positions:2,negative:0,unknown:0,zero:1,visibleStoreRows:2
  });
  const noMatches=selectStockPageGroups(entries,'Неизвестный склад');
  assert.deepEqual(noMatches,[]);
  assert.deepEqual(summarizeStockPageGroups(noMatches),{
    positions:0,negative:0,unknown:0,zero:0,visibleStoreRows:0
  });
  assert.equal(entries[0].stores.length,4);
});

test('unknown quantities stay unknown when filtering by a single warehouse',()=>{
  const item={name:'Коврик',stores:[
    {name:'Пламя. Магазин',stock:null},
    {name:'Основной склад (Цех)',stock:0}
  ]};
  const page=selectStockPageGroups([item],'Пламя. Магазин');
  assert.equal(page[0].stores[0].stock,null);
  assert.equal(summarizeStockPageGroups(page).unknown,1);
});

test('reject malformed data rather than masking invalid warehouse values',()=>{
  for(const input of [null,[{name:'broken'}],[{stores:[{}]}]])
    assert.throws(()=>pageWarehouseNames(input));
  assert.throws(()=>selectStockPageGroups('bad',''));
  assert.throws(()=>selectStockPageGroups(entries,null));
  assert.throws(()=>summarizeStockPageGroups('bad'));
});
