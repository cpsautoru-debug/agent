import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyWbCostCandidate,proposeWbCostsFromEvidence}
 from '../../web/office/wb-cost-candidates.mjs';
test('WB candidates use owner known product-category costs but remain unconfirmed',()=>{
 const cases=[
  ['веста №6',420000,'vesta'],
  ['веста кросс с оранжевыми сотами',450000,'cross'],
  ['карты_приора_черный_квадрат',35000,'door'],
  ['чехлы приора хб, алька черные соты',319900,'priora'],
  ['самара_белые_соты',320000,'samara'],
  ['искра с белыми сотами',469700,'iskra'],
  ['веста_чех_подлокот1',10000,'armrest'],
  ['накладка_на_бампер_калина_кросс',30000,'bumper']
 ];
 for(const [article,price,category] of cases){
  const x=classifyWbCostCandidate(article);
  assert.equal(x.costKopecks,price);
  assert.equal(x.kind,category);
  assert.equal(x.status,'needs_owner_confirmation');
 }
});
test('ambiguous WB articles do not get fabricated unit costs',()=>{
 for(const name of ['пламя1','wb4emqym9a']){
  const x=classifyWbCostCandidate(name);
  assert.equal(x.costKopecks,null);
  assert.equal(x.status,'unknown');
 }
});
test('category candidates do not change WB D1 or represent confirmed unit price',()=>{
 const data={code:'entity_income_evidence',month:'2026-10',
  readOnly:true,changedRecords:0,wb:{costReview:[
   {vendorCode:'веста №6',soldUnits:18,costStatus:'missing'},
   {vendorCode:'пламя1',soldUnits:17,costStatus:'missing'}
  ]}};
 const out=proposeWbCostsFromEvidence(data);
 assert.equal(out.articles,2);
 assert.equal(out.candidates,1);
 assert.equal(out.unknown,1);
 assert.equal(out.confirmedMappings,0);
 assert.equal(out.writeOperations,0);
 assert.equal(out.soldUnits,35);
 assert.throws(()=>proposeWbCostsFromEvidence({...data,changedRecords:1}));
});
test('WB review UI is wired, read-only and requires explicit owner confirmation',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/wb-cost-review-ui.mjs',import.meta.url),'utf8');
 assert.match(html,/wbCostCandidatesRows/);
 assert.match(html,/wb-cost-review-ui.mjs/);
 assert.match(js,/api\/finance\/income-evidence/);
 assert.doesNotMatch(js,/method:'POST'|\.innerHTML|localStorage/);
});
