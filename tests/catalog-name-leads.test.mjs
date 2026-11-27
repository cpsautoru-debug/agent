import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueNameLeads} from '../functions/api/ms/catalog-match.mjs';
const item=(id,name,archived=false)=>({id,name,archived,itemType:'product'});
test('name leads exclude cut pieces, archives and conflicting model or stitching',()=>{
 const rows=[item('a','Чехлы Lada Vesta SW Cross алькантара кокетки с серыми сотами'),item('b','Веста Кросс центра серые соты'),item('c','Чехлы Веста Кросс квадрат'),item('d','Чехлы Веста Кросс соты',true),item('e','Чехлы Приора соты')];
 const leads=catalogueNameLeads('веста кросс серые соты',rows);
 assert.deepEqual(leads.map(x=>x.id),['a']);assert.equal(leads[0].automaticApproval,false);
 assert.deepEqual(catalogueNameLeads('Пламя1',rows),[]);
});

test('requested grey cannot match black-only or unspecified colour, and Cross remains distinct',()=>{const rows=[item('a','Чехлы Веста Кросс серыми сотами'),item('b','Чехлы Веста Кросс черными сотами'),item('c','Чехлы Веста Кросс соты')];assert.deepEqual(catalogueNameLeads('веста кросс серые соты',rows).map(x=>x.id),['a']);assert.deepEqual(catalogueNameLeads('веста серые соты',rows),[]);});
