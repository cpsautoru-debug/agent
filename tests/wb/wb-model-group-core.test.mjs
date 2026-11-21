import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWbModelDraft,FAMILY_DEFINITIONS}
  from '../../web/office/wb-model-group-core.mjs';

test('group WB articles by tentative car model, never assign costs',()=>{
  const names=[
    'Веста коричневая','Vesta 3 black','Веста Кросс серая',
    'Vesta SW diamond','Приора белая','Priora 2','Искра чёрная',
    'Samara 2114','Granta 2017','Нива Travel','Hyundai Creta',
    'Rio 4','Дверные карты Vesta','EVA коврики Vesta',
    'Брелок Vesta','Без кода модели'
  ];
  const actual=buildWbModelDraft(names);
  assert.equal(actual.totalArticles,names.length);
  assert.equal(actual.confirmedMappingCount,0);
  assert.equal(actual.assignedCostCount,0);
  assert.equal(actual.readOnly,true);
  assert.equal(actual.changedRecords,0);
  const byId=Object.fromEntries(actual.groups.map(g=>[g.id,g]));
  assert.equal(byId.vesta.articleCount,2);
  assert.deepEqual(byId.vesta_cross.articles,['Веста Кросс серая']);
  assert.deepEqual(byId.vesta_sw.articles,['Vesta SW diamond']);
  assert.equal(byId.priora.articleCount,2);
  assert.equal(byId.iskra.articleCount,1);
  assert.equal(byId.samara.articleCount,1);
  assert.equal(byId.granta.articleCount,1);
  assert.equal(byId.niva_travel.articleCount,1);
  assert.equal(byId.creta.articleCount,1);
  assert.equal(byId.rio.articleCount,1);
  assert.equal(byId.door_inserts.articleCount,1);
  assert.equal(byId.accessories.articleCount,2);
  assert.equal(byId.unrecognized.articleCount,1);
  assert.ok(actual.groups.every(x=>x.confidence==='draft_not_product_identity'));
  assert.ok(actual.groups.every(x=>x.articles.every(name=>names.includes(name))));
  assert.equal(FAMILY_DEFINITIONS.some(x=>x.id==='vestacross'),false);
});
test('ambiguous articles do not fall into a made-up product family',()=>{
  const actual=buildWbModelDraft([
    'Vesta Priora combo','Веста Кросс и Iskra',
    'номер 19284','чехол без модели'
  ]);
  assert.equal(actual.groupCount,1);
  assert.equal(actual.groups[0].id,'unrecognized');
  assert.equal(actual.assignedCostCount,0);
});
test('reject invalid and duplicate codes rather than pretend source is complete',()=>{
  assert.throws(()=>buildWbModelDraft(['Vesta','Vesta']));
  assert.throws(()=>buildWbModelDraft(['broken\ncode']));
  assert.throws(()=>buildWbModelDraft(Array(1201).fill('Vesta')));
  assert.throws(()=>buildWbModelDraft(null));
  assert.equal(buildWbModelDraft([]).groupCount,0);
});
