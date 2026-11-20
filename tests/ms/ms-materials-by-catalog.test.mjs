import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCatalogPath,selectCatalogPage,countCatalogPageEvidence
} from '../../web/office/ms-materials-by-catalog.mjs';

const groups=[
  {name:'Алькантара',catalogPath:'ПРОИЗВОДСТВО/Экокожа и Алька/Стежка/Алькантара/Квадрат',uom:'м',stock:150},
  {name:'Pegas',catalogPath:'ПРОИЗВОДСТВО/Экокожа и Алька/Гладкая на 2-3мм',uom:'м',stock:40},
  {name:'Коврик готовый',catalogPath:'ПРОИЗВОДСТВО/Готовые товары/Коврики',uom:'шт',stock:4},
  {name:'Стеганый материал без группы',catalogPath:null,uom:'м',stock:80},
  {name:'Другая категория',catalogPath:'Прочее/Экокожа и Алька/Стежка',uom:'м',stock:10},
  {name:'Похожая группа',catalogPath:'ПРОИЗВОДСТВО/Экокожа и Алька архив/Стежка',uom:'м',stock:20}
];

test('only exact observed product folder yields material evidence',()=>{
  assert.equal(classifyCatalogPath('ПРОИЗВОДСТВО/Экокожа и Алька/Гладкая на 2-3мм'),'MATERIAL_FOLDER_EVIDENCE');
  assert.equal(classifyCatalogPath(' производство / ЭКОКОЖА И АЛЬКА /Стежка/Квадрат'),'MATERIAL_FOLDER_EVIDENCE');
  assert.equal(classifyCatalogPath('ПРОИЗВОДСТВО/Экокожа и Алька'),'MATERIAL_FOLDER_EVIDENCE');
  for(const category of [null,undefined,'','Экокожа и Алька',
    'ПРОИЗВОДСТВО/Экокожа и Алька архив/Стежка',
    'Прочее/Экокожа и Алька/Стежка',
    'ПРОИЗВОДСТВО/Готовые товары/Коврики',
    'ПРОИЗВОДСТВО//Экокожа и Алька',
    'ПРОИЗВОДСТВО/Экокожа и Алька\n/Стежка',
    'продукт Экокожа и Алька',
    123
  ])assert.equal(classifyCatalogPath(category),'UNVERIFIED',String(category));
});

test('page-only filter does not guess raw material type by product title or unit',()=>{
  const materials=selectCatalogPage(groups,'materials');
  assert.deepEqual(materials.map(x=>x.name),['Алькантара','Pegas']);
  const unverified=selectCatalogPage(groups,'unverified');
  assert.equal(unverified.length,4);
  assert.equal(unverified.some(x=>x.name==='Стеганый материал без группы'),true);
  assert.equal(unverified.some(x=>x.name==='Коврик готовый'),true);
  assert.deepEqual(selectCatalogPage(groups,'all'),groups);
  assert.deepEqual(countCatalogPageEvidence(groups),{
    material:2,unverified:4,total:6,scope:'CURRENT_API_PAGE_ONLY'
  });
});

test('unknown category does not become finished goods, and numbers are unchanged',()=>{
  const visible=selectCatalogPage(groups,'materials');
  assert.equal(visible[0].stock,150);
  assert.equal(visible[1].stock,40);
  assert.equal(groups[3].stock,80);
  assert.equal(groups.length,6);
  assert.equal(countCatalogPageEvidence([]).material,0);
});

test('invalid client selection and invalid rows fail instead of pretending no inventory',()=>{
  for(const filter of [null,'finished','all%20',123])
    assert.throws(()=>selectCatalogPage(groups,filter));
  assert.throws(()=>selectCatalogPage(null,'all'));
  assert.throws(()=>selectCatalogPage([{name:'a'},null],'all'));
});
