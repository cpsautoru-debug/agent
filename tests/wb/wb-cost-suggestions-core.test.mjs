import test from 'node:test';
import assert from 'node:assert/strict';
import {findOzonCostSuggestions} from '../../web/office/wb-cost-suggestions-core.mjs';

const wb=[{vendorCode:'VESTA3'},{vendorCode:'Door-Inserts'},
  {vendorCode:'VESTA-EXTRA'},{vendorCode:'GRANTA'}];
const cost=(article,sku,kopecks,status='confirmed')=>({
  seller_article:article,sku,model:'Lada Vesta',
  cost_kopecks:kopecks,status,source:'Проверенный норматив цеха'
});
test('exact article matches only already confirmed Ozon COGS and never writes to WB',()=>{
  const result=findOzonCostSuggestions(wb,[
    cost('VESTA3','OZON-103',420000),
    cost('Door-Inserts','OZON-211',35000),
    cost('vesta3','OZON-999',600000),
    cost('VESTA-EXTRA','OZON-100','3900','confirmed'),
    cost('GRANTA','OZON-31',300000,'preliminary'),
    cost('Not_In_WB','OZON-34',120000)
  ]);
  assert.equal(result.source,'OZON_CONFIRMED_COST_ENTRIES_EXACT_ARTICLE_ONLY');
  assert.equal(result.readOnly,true);
  assert.equal(result.changedRecords,0);
  assert.deepEqual(result.suggestions.map(x=>x.vendorCode),
    ['Door-Inserts','VESTA3'].sort((a,b)=>a.localeCompare(b,'ru')));
  assert.ok(result.suggestions.every(x=>x.status==='candidate_needs_owner_confirmation'));
  assert.equal(result.ambiguousVendorCodes.length,0);
  assert.equal(result.rejectedMatches,2);
  assert.equal(result.notMatchedCount,2);
  assert.ok(result.suggestions.every(x=>!Object.hasOwn(x,'validFrom')));
});
test('duplicate seller article in Ozon is ambiguous even when same cost',()=>{
  const result=findOzonCostSuggestions([{vendorCode:'VESTA3'}],[
    cost('VESTA3','SKU1',420000),cost('VESTA3','SKU2',420000)
  ]);
  assert.equal(result.suggestions.length,0);
  assert.deepEqual(result.ambiguousVendorCodes,['VESTA3']);
  assert.equal(result.notMatchedCount,0);
});
test('bad input or duplicate WB article does not silently turn into a match',()=>{
  assert.throws(()=>findOzonCostSuggestions([{vendorCode:'A'},{vendorCode:'A'}],[]));
  assert.throws(()=>findOzonCostSuggestions([{vendorCode:'bad\ncode'}],[]));
  assert.throws(()=>findOzonCostSuggestions(wb,Array.from({length:5001},
    ()=>cost('GRANTA','SKU',250000))));
  assert.throws(()=>findOzonCostSuggestions([],null));
  assert.deepEqual(findOzonCostSuggestions([],[]).suggestions,[]);
});

test('zero overlap reports Ozon catalog availability, not zero production costs',()=>{
  const result=findOzonCostSuggestions(
    [{vendorCode:'VESTA-001'},{vendorCode:'GRANTA-002'}],[
      cost('PRI-029','OZON-PR-3',350000),
      cost('ISC-030','OZON-ISC-3',420000,'preliminary')
    ]);
  assert.equal(result.notMatchedCount,2);
  assert.equal(result.suggestions.length,0);
  assert.equal(result.normalizedCandidates.length,0);
  assert.deepEqual(result.sourceStats,{
    ozonCostRows:2,confirmedRows:1,preliminaryRows:1,
    confirmedWithArticle:1,matchingArticleRows:0
  });
});
test('unique case-and-separator differences become review-only candidates, never confirmed COGS',()=>{
  const result=findOzonCostSuggestions([
    {vendorCode:'VESTA-001'},{vendorCode:'Door_12'}
  ],[
    cost('vesta_001','OZ-V-3',420000),
    cost('DOOR-12','OZ-DR-3',35000)
  ]);
  assert.equal(result.suggestions.length,0);
  assert.deepEqual(result.normalizedCandidates.map(x=>x.vendorCode),
    ['Door_12','VESTA-001'].sort((a,b)=>a.localeCompare(b,'ru')));
  assert.ok(result.normalizedCandidates.every(x=>
    x.status==='normalized_candidate_needs_owner_confirmation'));
  assert.equal(result.readOnly,true);
  assert.equal(result.changedRecords,0);
});
test('ambiguous normalized matches and numeric codes must not suggest a cost',()=>{
  const result=findOzonCostSuggestions([
    {vendorCode:'VESTA-001'},{vendorCode:'vesta_001'},{vendorCode:'123456789'}
  ],[
    cost('Vesta.001','OZ-V-3',420000),
    cost('123-456789','OZ-000',99900)
  ]);
  assert.equal(result.normalizedCandidates.length,0);
  assert.equal(result.normalizedAmbiguousVendorCodes.length,2);
});
