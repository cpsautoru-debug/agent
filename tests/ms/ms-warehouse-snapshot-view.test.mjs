import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWarehouseItem,filterSnapshotItems,snapshotCounts
} from '../../web/office/ms-warehouse-snapshot-view.mjs';
const demo=[
  {name:'Pegas',catalogPath:'ПРОИЗВОДСТВО/Экокожа и Алька/Гладкая на 2-3мм',uom:'м',stock:40},
  {name:'Коврик HAVAL',catalogPath:'Коврики Ева Пресс форма/Иномарки/HAVAL',uom:'шт',stock:1},
  {name:'Коврик Hyundai',catalogPath:'коврики ева пресс форма/Иномарки/Hyundai',uom:'шт',stock:3},
  {name:'Коврик без группы',catalogPath:null,uom:null,stock:1},
  {name:'Коврик другой группы',catalogPath:'Коврики Ева Пресс форма/Архив/Иномарки',stock:1},
  {name:'Другие товары',catalogPath:'ПРОИЗВОДСТВО/Другие товары/Коврики',stock:5}
];
test('exact real folder segments classify raw material and EVA merchandise only',()=>{
  assert.equal(classifyWarehouseItem(demo[0]),'materials');
  assert.equal(classifyWarehouseItem(demo[1]),'eva');
  assert.equal(classifyWarehouseItem(demo[2]),'eva');
  assert.equal(classifyWarehouseItem(demo[3]),'unverified');
  assert.equal(classifyWarehouseItem(demo[4]),'unverified');
  assert.equal(classifyWarehouseItem(demo[5]),'unverified');
});
test('unknown catalog category is not guessed from article name or units',()=>{
  for(const value of [
    {name:'Готовые чехлы',catalogPath:null,uom:'шт'},
    {name:'Экокожа',catalogPath:'Товары/Готовые чехлы'},
    {name:'Коврики Ева Пресс форма',catalogPath:null},
    {name:'Коврик',catalogPath:'Коврики Ева Пресс форма//Hyundai'}
  ])assert.equal(classifyWarehouseItem(value),'unverified');
});
test('local categories do not mutate stocks, units, or original items',()=>{
  assert.deepEqual(snapshotCounts(demo),{materials:1,eva:2,unverified:3,total:6});
  assert.equal(filterSnapshotItems(demo,'materials')[0].stock,40);
  assert.deepEqual(filterSnapshotItems(demo,'eva').map(x=>x.name),
    ['Коврик HAVAL','Коврик Hyundai']);
  assert.equal(filterSnapshotItems(demo,'unverified').length,3);
  assert.deepEqual(filterSnapshotItems(demo,'all'),demo);
  assert.equal(demo[1].stock,1);
  assert.equal(demo[2].uom,'шт');
});
test('unknown/invalid selection fails explicitly',()=>{
  for(const selection of ['finished','ready','',null,123])
    assert.throws(()=>filterSnapshotItems(demo,selection));
  assert.throws(()=>snapshotCounts(null));
  assert.throws(()=>filterSnapshotItems([null],'all'));
});
