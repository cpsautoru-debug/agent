import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {missingCatalogRows,buildCatalogFixCsv} from '../../web/office/ms-catalog-quality-export.mjs';
const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../../web/office/ms-warehouse-snapshot.mjs',import.meta.url),'utf8');
const source=[
  {name:'Коврики Eva CS35',code:'118',stock:1,uom:null,catalogPath:null},
  {name:'Haval Press',code:'0074',stock:1,uom:'шт',
    catalogPath:'Коврики Ева Пресс форма/Иномарки/HAVAL'},
  {name:'Ford Mondeo',code:'083',stock:3,uom:null,catalogPath:null},
  {name:'Материал',code:'728562135',stock:40,uom:'м',
    catalogPath:'ПРОИЗВОДСТВО/Экокожа и Алька/Гладкая'},
  {name:'=HYPERLINK("https://evil.invalid","go")',code:'+CMD',stock:-0.8,uom:null,catalogPath:null}
];
test('only genuinely incomplete catalog groups or units appear in local CSV',()=>{
  const issues=missingCatalogRows(source);
  assert.equal(issues.length,3);
  assert.deepEqual(issues.map(x=>x.code),['118','083','+CMD']);
  const out=buildCatalogFixCsv(source,'Пламя. Магазин');
  assert.equal(out.rows,3);
  assert.ok(out.csv.startsWith('\uFEFF'));
  assert.equal(out.csv.trim().split('\r\n').length,4);
  assert.match(out.csv,/Нет группы, Нет единицы/);
  assert.match(out.csv,/Только проверка номенклатуры; не импортировать автоматически/);
  assert.doesNotMatch(out.csv,/728562135|Haval Press/);
});
test('CSV protects against spreadsheet formulas and escapes quotes',()=>{
  const {csv}=buildCatalogFixCsv(source,'Пламя. Магазин');
  assert.match(csv,/"'=HYPERLINK\(""https:\/\/evil.invalid"",""go""\)"/);
  assert.match(csv,/"'\+CMD"/);
  assert.match(csv,/"'-0\.8"/);
  const dangerous=buildCatalogFixCsv([
    {name:'\r\n=1+2',code:'@test',stock:4,uom:null,catalogPath:null}
  ],'Пламя. Магазин');
  assert.doesNotMatch(dangerous.csv,/\r\n=1\+2/);
  assert.match(dangerous.csv,/"'@test"/);
});
test('output is limited to previously verified one-store snapshot',()=>{
  assert.throws(()=>missingCatalogRows(Array(41).fill({name:'a'})));
  assert.throws(()=>missingCatalogRows(null));
  assert.throws(()=>missingCatalogRows([null]));
  assert.throws(()=>buildCatalogFixCsv([],'')); 
  assert.equal(buildCatalogFixCsv([],'Пламя. Магазин').rows,0);
});
test('user explicitly clicks to download reference list, no server writes',()=>{
  assert.equal((html.match(/id="msWarehouseSnapshotExportMissing"/g)||[]).length,1);
  assert.match(js,/exportButton\.addEventListener\('click'/);
  assert.match(js,/buildCatalogFixCsv\(snapshot\.items,snapshot\.warehouseName\)/);
  assert.match(js,/new Blob/);
  assert.match(js,/URL\.createObjectURL/);
  assert.match(js,/download='autosklad63-catalog-review-/);
  assert.match(js,/Это только список на исправление/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|method:'POST'|navigator\.sendBeacon/);
});
