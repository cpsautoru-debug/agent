import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMoyskladDiscrepancyReport as report,reviewDocumentIdentities,SHEET_MAPPING,WORKBOOK_ID} from './moysklad-reconcile.mjs';
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const ref=(type,n)=>({meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+uid(n)}});
const at='2026-10-20T08:00:00+04:00';
function input(){
  const sheets=Object.entries(SHEET_MAPPING).map(([title,s])=>{const rows=Array.from({length:s.headerRow},()=>[]);for(const [c,h] of Object.entries(s.headers))rows[s.headerRow-1][c]=h;for(const [c,h] of Object.entries(s.headerPrefixes||{}))rows[s.headerRow-1][c]=h+' (пример)';return {title,asOf:at,rows};});
  sheets.find(s=>s.title==='Остаток').rows.push(['Материал А','м',15,2,3,10,100]);
  return {sheetSnapshot:{spreadsheetId:WORKBOOK_ID,asOf:at,sheets},catalogSnapshot:{complete:true,rows:[{id:uid(1),name:'Материал А',uom:ref('uom',3)}]},stockSnapshot:{complete:true,asOf:at,rows:[{...ref('product',1),stockByStore:[{...ref('store',2),stock:13,reserve:7,quantity:6}]}]},bindings:[{sheet:'Остаток',row:2,sheetItem:'Материал А',approved:true,assortmentId:uid(1),storeId:uid(2),uomId:uid(3),sheetUnit:'м',asOf:at}]};
}
const codes=r=>r.issues.map(i=>i.code);
test('stock reconciliation compares physical stock in one store, never mutates cells or emits writes',()=>{
  const data=input(),before=structuredClone(data),r=report(data);assert.equal(r.comparisons.length,1);assert.equal(r.comparisons[0].delta,3);assert.equal(r.comparisons[0].moyskladStock,13);assert.ok(codes(r).includes('STOCK_DIFFERENCE'));assert.deepEqual(r.writeOperations,[]);assert.deepEqual(data,before);
});
test('same-name match is only a candidate; no automatic approval or quantity conversion',()=>{
  const data=input();data.bindings=[];const r=report(data);assert.equal(r.comparisons.length,0);assert.equal(r.issues.find(i=>i.code==='MAPPING_REQUIRED').candidateIds[0],uid(1));
  data.bindings=input().bindings;data.bindings[0].sheetUnit='шт';assert.ok(codes(report(data)).includes('STORE_OR_UNIT_MAPPING_REQUIRED'));
});
test('missing stocks and blank/formula quantities cannot silently become zero',()=>{
  const data=input();data.stockSnapshot.rows=[];assert.ok(codes(report(data)).includes('STOCK_MISSING_OR_DUPLICATE'));
  for(const value of ['',null,'=SUM(A1:A2)',NaN]){const d=input();d.sheetSnapshot.sheets.find(s=>s.title==='Остаток').rows[1][5]=value;assert.ok(codes(report(d)).includes('NON_NUMERIC_QUANTITY'));}
});
test('date, schema, incomplete pages and wrong workbook prevent comparison',()=>{
  const data=input();data.stockSnapshot.asOf='2026-10-21T08:00:00+04:00';assert.ok(codes(report(data)).includes('SNAPSHOT_TIME_MISMATCH'));
  const changed=input();changed.sheetSnapshot.sheets[0].rows[0][5]='Другое';assert.ok(codes(report(changed)).includes('SHEET_SCHEMA_CHANGED'));
  const partial=input();partial.catalogSnapshot.complete=false;assert.deepEqual(codes(report(partial)),['INCOMPLETE_SOURCE']);
  assert.deepEqual(codes(report({...input(),sheetSnapshot:{spreadsheetId:'other'}})),['WRONG_WORKBOOK']);
});
test('duplicate binding, catalogue IDs and stores block matching',()=>{
  const a=input();a.bindings.push({...a.bindings[0]});assert.ok(codes(report(a)).includes('DUPLICATE_ROW_BINDING'));assert.equal(report(a).comparisons.length,0);
  const b=input();b.catalogSnapshot.rows.push({...b.catalogSnapshot.rows[0]});assert.ok(codes(report(b)).includes('CATALOG_ID_NOT_UNIQUE'));
  const c=input();c.stockSnapshot.rows.push(structuredClone(c.stockSnapshot.rows[0]));assert.ok(codes(report(c)).includes('STOCK_MISSING_OR_DUPLICATE'));
});
test('dated cut inventory requires explicit unit/store and refuses incomplete pieces',()=>{
  const data=input(),sheet=data.sheetSnapshot.sheets.find(s=>s.title==='Инвентаризация кроя 20.10');sheet.rows.push([1,'Крой А','',4,'2 детали','']);
  data.bindings.push({...data.bindings[0],sheet:sheet.title,row:5,sheetItem:'Крой А'});
  assert.ok(codes(report(data)).includes('PARTIAL_PIECES_REQUIRE_REVIEW'));
});
test('BOM and operations are linked for review, not subtracted again from stock',()=>{
  const data=input(),sheet=data.sheetSnapshot.sheets.find(s=>s.title==='Раскрой');sheet.rows.push([0,'Крой А','Материал А',2,'шт']);data.bindings.push({...data.bindings[0],sheet:sheet.title,row:2,sheetItem:'Крой А'});
  const r=report(data);assert.equal(r.mappingReview.length,1);assert.equal(r.mappingReview[0].status,'requires-document-or-specification-link');assert.equal(r.comparisons[0].delta,3);assert.deepEqual(r.writeOperations,[]);
});
test('review ledger handles repeats, changed/unapplied documents and missing identity without processing',()=>{
  const doc={id:uid(5),accountId:uid(6),meta:{type:'processing'},updated:'2026-10-20 08:00:00',applied:true,materials:{rows:[{id:uid(7),quantity:2}]}};
  const first=reviewDocumentIdentities([doc,structuredClone(doc)]);assert.equal(first.proposedLedger.length,1);assert.equal(first.issues[0].code,'DUPLICATE_DOCUMENT');assert.deepEqual(first.writeOperations,[]);
  assert.equal(reviewDocumentIdentities([doc],first.proposedLedger).proposedLedger[0].state,'already-reviewed');
  const changed=reviewDocumentIdentities([{...doc,applied:false}],first.proposedLedger);assert.ok(changed.issues.some(i=>i.code==='DOCUMENT_CHANGED'));assert.ok(changed.issues.some(i=>i.code==='DOCUMENT_NOT_APPLIED'));
  assert.equal(reviewDocumentIdentities([{id:uid(1)}]).issues[0].code,'DOCUMENT_IDENTITY_MISSING');
});
