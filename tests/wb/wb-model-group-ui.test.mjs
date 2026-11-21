import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachWbModelDraft} from '../../web/office/wb-model-group-ui.mjs';

function node(){
  return {textContent:'',value:'',disabled:false,children:[],handlers:{},
    append(item){this.children.push(item);},
    replaceChildren(){this.children=[];},
    addEventListener(kind,fn){this.handlers[kind]=fn;}
  };
}
function fixture(codes=['Веста коричневая','Веста кросс белая',
  'Дверные карты Priora','Коврики EVA Vesta','Без модели']){
  const ids=['wbModelDraftBuild','wbModelDraftStatus',
    'wbModelDraftGroups','wbUnitCostVendor'];
  const dom=Object.fromEntries(ids.map(id=>[id,node()]));
  dom.wbUnitCostVendor.options=[{value:''},...codes.map(value=>({value}))];
  const documentRef={
    getElementById(id){return dom[id]||null;},
    createElement(){return node();}
  };
  assert.equal(attachWbModelDraft({documentRef}),true);
  return dom;
}
test('button groups actual article codes after manual click; no API request or DB write',()=>{
  const dom=fixture();
  assert.equal(dom.wbModelDraftGroups.children.length,0);
  dom.wbModelDraftBuild.handlers.click();
  assert.match(dom.wbModelDraftStatus.textContent,/5 артикулов/);
  assert.match(dom.wbModelDraftStatus.textContent,/0/);
  const groups=dom.wbModelDraftGroups.children;
  assert.equal(groups.length,5);
  assert.ok(groups.every(g=>g.children.length===2));
  assert.ok(groups.every(g=>g.children[0].textContent.includes('артикул')));
  assert.ok(groups.some(g=>g.children[0].textContent.includes('Lada Vesta Cross')));
});
test('owner-only WB article list must exist before classification',()=>{
  const dom=fixture([]);
  dom.wbUnitCostVendor.disabled=true;
  dom.wbModelDraftBuild.handlers.click();
  assert.equal(dom.wbModelDraftGroups.children.length,0);
  assert.match(dom.wbModelDraftStatus.textContent,/Сначала обнови расчёт WB/);
});
test('ui is read-only and attached only once in authenticated financial section',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const source=readFileSync(new URL('../../web/office/wb-model-group-ui.mjs',import.meta.url),'utf8');
  for(const id of ['wbModelDraftPanel','wbModelDraftBuild',
    'wbModelDraftStatus','wbModelDraftGroups'])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert.match(html,/wb-model-group-ui\.mjs\?v=20261121/);
  assert.match(html,/черновик/);
  assert.doesNotMatch(source,/fetch\(|INSERT|UPDATE|POST|confirm\(/);
});
