import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectWbCardsPage,finalizeWbCardLookup
} from '../../web/office/finance-wb-card-lookup-core.mjs';
const codes=['веста №2','карты_лада_веста_белые_соты'];
test('matches only exact finance vendor code and preserves actual card title',()=>{
  const page=inspectWbCardsPage({
    cards:[
      {vendorCode:'веста №2',title:'Авточехлы Lada Vesta',
        subjectName:'Авточехлы',nmID:9911},
      {vendorCode:'веста №2b',title:'Fake matching prefix',nmID:1},
      {vendorCode:'карты_лада_веста_белые_соты',
        title:'Дверные вставки Lada Vesta'}
    ],cursor:{total:3}
  },codes);
  assert.equal(page.total,3);
  assert.deepEqual(page.entries.map(x=>x.vendorCode),codes);
  assert.equal(page.entries[0].title,'Авточехлы Lada Vesta');
  assert.equal(page.entries[0].physicalIdentityVerified,false);
  assert.equal(page.entries[0].costTransferred,false);
});
test('unscanned cards are unresolved, never treated as absent',()=>{
  const result=finalizeWbCardLookup({codes,
    found:[{vendorCode:codes[0],title:'Авточехлы'}],
    complete:false,pages:3});
  assert.equal(result.fullyScanned,false);
  assert.equal(result.unmatchedAreAbsentFromCurrentCards,false);
  assert.deepEqual(result.unmatched,[codes[1]]);
  assert.equal(result.changedRecords,0);
});
test('rejects incomplete payload, unexpected IDs and duplicate output',()=>{
  assert.throws(()=>inspectWbCardsPage({cards:[],cursor:{}},codes));
  assert.throws(()=>finalizeWbCardLookup({codes,found:[
    {vendorCode:codes[0]},{vendorCode:codes[0]}],complete:true,pages:1}));
  assert.throws(()=>finalizeWbCardLookup({codes,found:[
    {vendorCode:'foreign-code'}],complete:true,pages:1}));
});
