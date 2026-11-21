import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyInventory,isProductionAssortment,inventoryRows,summarizeInventory
} from '../../web/office/ms-inventory-control-view.mjs';

const item=(name,catalogPath,uom='шт',stock=5,warehouse='Основной склад')=>({
  name,catalogPath,uom,code:null,
  stores:[{name:warehouse,stock,reserve:0,inTransit:null}]
});
const stock=[
  item('Коврики EVA 3D Lada Vesta','Производство/Готовая продукция/Коврики', 'шт',800,'Склад ЕВА'),
  item('Ковры пресс-формы Веста','Производство/Ковры', 'м',20,'Склад ЕВА'),
  item('EVA 3D производство','Коврики ЕВА пресс форма/Иномарки','м',22,'Склад ЕВА'),
  item('Ароматизатор Веста','Продажи/Автотовары'),
  item('Брелок Vesta','Продажи/Брелоки'),
  item('Накидка Веста','Продажи/Накидки'),
  item('Зимняя защита радиатора Lada','Продажи/Пластик'),
  item('Чехол на подголовник','Продажи/Аксессуары'),
  item('Чехол на телефон','Продажи/Аксессуары'),
  item('Задние тормозные диски ВАЗ','Продажи/Запчасти'),
  item('Чехлы на сиденья Vesta','Авточехлы/Lada Vesta','компл',11),
  item('Vesta Cross','Производство/Готовая продукция','компл',9),
  item('Чехлы для сидений Priora','Чехлы/Приора','компл',3),
  item('Дверные карты Lada Vesta','Дверные карты','компл',7),
  item('Вставки дверей Priora','Производство/Дверные вставки','компл',4),
  item('Экокожа чёрная 0.8','Производство/Экокожа и алька','м',39.5),
  item('Pegas 0.8','Производство/Экокожа и алька','п.м',40),
  item('Поролон 2 мм','Производство/Материалы','м',38),
  item('Спанбонд чёрный','Производство/Материалы','м',42),
  item('Крой Vesta Cross','Производство/Крой','компл',12),
  item('Крой сидений Priora','Производство/Крой','компл',18),
  item('Комплект Samara','Производство/Номенклатура','шт',2)
];

test('EVA carpets, car parts, accessories and other non-target stock are excluded everywhere',()=>{
  const visible=inventoryRows(stock);
  assert.equal(visible.length,12);
  for(const row of visible){
    assert.doesNotMatch([row.name,row.catalogPath,row.warehouse].join(' '),
      /ковр|коврик|ароматиз|брелок|накидк|радиатор|тормоз|подголовник|телефон/iu);
  }
  const excluded=stock.slice(0,10);
  assert.ok(excluded.every(x=>classifyInventory(x)==='excluded'));
  assert.ok(excluded.every(x=>!isProductionAssortment(x)));
  assert.deepEqual(inventoryRows(stock,'all','','all').map(x=>x.name),
    stock.slice(10).map(x=>x.name));
  assert.ok(!inventoryRows(stock,'all','','low').some(x=>/ковр|eva|эва/iu.test(x.name)));
  assert.ok(!inventoryRows(stock,'all','','negative').some(x=>/ковр|eva|эва/iu.test(x.name)));
});
test('seat covers, door panels, materials and cut remain with their own model quantities',()=>{
  assert.deepEqual(stock.slice(10).map(classifyInventory),[
    'covers','finished','covers','doorCards','doorCards',
    'materials','materials','materials','materials','cut','cut','unverified'
  ]);
  assert.deepEqual(inventoryRows(stock,'all','','doorCards').map(x=>x.stock),[7,4]);
  assert.deepEqual(inventoryRows(stock,'all','','cut').map(x=>x.stock),[12,18]);
  assert.deepEqual(inventoryRows(stock,'all','','finished').map(x=>x.stock),[9]);
  assert.deepEqual(inventoryRows(stock,'all','','covers').map(x=>x.stock),[11,3]);
  assert.deepEqual(inventoryRows(stock,'all','','low').map(x=>[x.name,x.stock]),[
    ['Экокожа чёрная 0.8',39.5],['Поролон 2 мм',38]
  ]);
  assert.equal(inventoryRows(stock,'all','','all').some(x=>x.name==='Pegas 0.8'),true);
  assert.equal(inventoryRows(stock,'all','Vesta').length,4);
});
test('summary only counts in-scope stock, never counts the carpets warehouse or its 20 metres',()=>{
  const summary=summarizeInventory(stock,stock.length,stock.length);
  assert.equal(summary.complete,true);
  assert.equal(summary.loaded,22);
  assert.equal(summary.productionItems,12);
  assert.equal(summary.hiddenOtherItems,10);
  assert.equal(summary.categories.materials,4);
  assert.equal(summary.categories.cut,2);
  assert.equal(summary.categories.finished,1);
  assert.equal(summary.categories.covers,2);
  assert.equal(summary.categories.doorCards,2);
  assert.equal(summary.categories.unverified,1);
  assert.equal(summary.counts.low,2);
  assert.deepEqual(summary.warehouses,['Основной склад']);
  assert.equal(summary.warehouses.includes('Склад ЕВА'),false);
});
test('out-of-production items are excluded even when named for a known model',()=>{
  for(const [name,path] of [
    ['Накладка на задний бампер Веста','Производство/Готовая продукция'],
    ['Чехол на подлокотник Vesta','Производство/Готовая продукция'],
    ['Коврики Vesta','Производство/Готовая продукция'],
    ['Пластиковая заглушка','Производство/Пластиковые детали']
  ])assert.equal(classifyInventory(item(name,path)),'excluded');
  assert.equal(classifyInventory(item('Дверные карты Vesta','Дверные карты')),'doorCards');
  assert.equal(classifyInventory(item('Чехол на сиденья Priora','Чехлы/Приора')),'covers');
  assert.equal(classifyInventory(item('Pegas чёрная 0,8',null,'м',24)),'materials');
});
