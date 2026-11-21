import test from 'node:test';
import assert from 'node:assert/strict';
import {attachOzonCostSuggestions}
  from '../../web/office/wb-cost-suggestions-ui.mjs';

function element(){
  return {
    textContent:'',value:'',disabled:false,checked:false,children:[],
    options:[],handlers:{},className:'',
    addEventListener(event,fn){this.handlers[event]=fn;},
    append(node){this.children.push(node);},
    replaceChildren(){this.children=[];},
    dispatchEvent(event){this.handlers[event.type]?.(event);},
    focus(){this.focused=true;}
  };
}
const ids=['wbOzonCostHintsLoad','wbOzonCostHintsStatus',
  'wbOzonCostHintsRows','wbUnitCostVendor','wbUnitCostAmount',
  'wbUnitCostFrom','wbUnitCostSource','wbUnitCostStatus',
  'wbUnitCostAttestation','wbUnitCostPreview','wbUnitCostConfirm'];
function setup({costs=[],fetchFail=false,articleCodes=['VESTA3','DOOR1']}={}){
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  const vendor=elements.wbUnitCostVendor;
  vendor.options=[{value:''},...articleCodes.map(value=>({value}))];
  const documentRef={
    getElementById(id){return elements[id]||null;},
    createElement(){return element();}
  };
  const requests=[];
  const fetchCosts=async(url,options)=>{
    requests.push({url,options});
    if(fetchFail)return {ok:false,status:503};
    return {ok:true,async json(){return {currency:'RUB',costs};}};
  };
  attachOzonCostSuggestions({documentRef,fetchCosts,
    formatCurrency:k=>(k/100).toFixed(2)+' ₽'});
  return {elements,requests};
}
async function flush(){for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));}
const matched={
  seller_article:'VESTA3',sku:'OZ-1',model:'Vesta',
  cost_kopecks:420000,status:'confirmed',source:'Проверенная техкарта'
};
test('one click reads Ozon owner API and displays exact candidate, no save',async()=>{
  const {elements,requests}=setup({costs:[matched]});
  assert.equal(requests.length,0);
  elements.wbOzonCostHintsLoad.handlers.click();
  await flush();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/ozon/costs');
  assert.equal(requests[0].options.method,'GET');
  assert.equal(requests[0].options.credentials,'same-origin');
  assert.equal(elements.wbOzonCostHintsRows.children.length,1);
  assert.match(elements.wbOzonCostHintsStatus.textContent,/1/);
  // No more fetches or writes until the owner acts.
});
test('suggestion prefill is PRELIMINARY, clears date and confirms nothing',async()=>{
  const {elements,requests}=setup({costs:[matched]});
  elements.wbOzonCostHintsLoad.handlers.click();
  await flush();
  const tbody=elements.wbOzonCostHintsRows;
  const actionCell=tbody.children[0].children.at(-1);
  const choose=actionCell.children[0];
  elements.wbUnitCostFrom.value='2026-11-01';
  elements.wbUnitCostStatus.value='confirmed';
  elements.wbUnitCostAttestation.checked=true;
  choose.handlers.click();
  assert.equal(elements.wbUnitCostVendor.value,'VESTA3');
  assert.equal(elements.wbUnitCostAmount.value,'4200.00');
  assert.equal(elements.wbUnitCostFrom.value,'');
  assert.equal(elements.wbUnitCostStatus.value,'preliminary');
  assert.equal(elements.wbUnitCostAttestation.checked,false);
  assert.equal(elements.wbUnitCostConfirm.disabled,true);
  assert.match(elements.wbUnitCostSource.value,/Подсказка Ozon/);
  assert.match(elements.wbOzonCostHintsStatus.textContent,/ничего не сохранено/i);
  assert.equal(elements.wbUnitCostPreview.focused,true);
  assert.equal(requests.length,1); // GET only, no POST
});
test('unavailable Ozon cost source does not affect WB finance screen',async()=>{
  const {elements,requests}=setup({fetchFail:true});
  elements.wbOzonCostHintsLoad.handlers.click();
  await flush();
  assert.equal(requests.length,1);
  assert.equal(elements.wbOzonCostHintsRows.children.length,0);
  assert.match(elements.wbOzonCostHintsStatus.textContent,/не удалось/i);
});
test('suggestions do not load until WB articles are confirmed',async()=>{
  const {elements,requests}=setup({articleCodes:[]});
  elements.wbOzonCostHintsLoad.handlers.click();
  await flush();
  assert.equal(requests.length,0);
  assert.match(elements.wbOzonCostHintsStatus.textContent,/Сначала обнови расчёт WB/);
});

test('normalized code match is visibly tentative and never posts a cost',async()=>{
  const row={...matched,seller_article:'vesta_3'};
  const {elements,requests}=setup({costs:[row],articleCodes:['VESTA-3']});
  elements.wbOzonCostHintsLoad.handlers.click();
  await flush();
  assert.equal(elements.wbOzonCostHintsRows.children.length,1);
  assert.match(elements.wbOzonCostHintsRows.children[0].children[3].textContent,
    /Только регистр/);
  const tr=elements.wbOzonCostHintsRows.children[0];
  tr.children.at(-1).children[0].handlers.click();
  assert.equal(elements.wbUnitCostVendor.value,'VESTA-3');
  assert.equal(elements.wbUnitCostFrom.value,'');
  assert.equal(elements.wbUnitCostAttestation.checked,false);
  assert.equal(elements.wbUnitCostStatus.value,'preliminary');
  assert.match(elements.wbUnitCostSource.value,/Кандидат Ozon/);
  assert.equal(elements.wbUnitCostConfirm.disabled,true);
  assert.equal(requests.length,1);
});
test('empty Ozon cost register gets an explicit no-cost-source explanation',async()=>{
  const {elements}=setup({costs:[],articleCodes:['VESTA-3','GRANTA-2']});
  elements.wbOzonCostHintsLoad.handlers.click();
  await flush();
  assert.match(elements.wbOzonCostHintsStatus.textContent,
    /Справочник Ozon: 0 записей/);
  assert.match(elements.wbOzonCostHintsStatus.textContent,
    /подтверждённых цен с артикулом продавца.*нет/);
});
