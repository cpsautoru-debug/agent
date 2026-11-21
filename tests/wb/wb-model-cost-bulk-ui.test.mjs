import test from 'node:test';
import assert from 'node:assert/strict';
import {mountModelCostReview}
  from '../../web/office/wb-model-cost-bulk-ui.mjs';
import {validateModelCostBatch}
  from '../../web/office/wb-model-cost-bulk-core.mjs';
const node=tag=>({
  tagName:tag.toUpperCase(),children:[],handlers:{},
  textContent:'',value:'',checked:false,disabled:false,
  append(...children){this.children.push(...children);},
  setAttribute(){},focus(){this.focused=true;},
  addEventListener(type,fn){this.handlers[type]=fn;},
  replaceChildren(){this.children=[];}
});
function fixture({id='vesta',codes=['Веста коричневая','Vesta 3 black']}={}){
  const parent=node('details'),requests=[];
  const responses=[];
  const post=async(url,options)=>{
    requests.push({url,options});
    const body=JSON.parse(options.body);
    if(body.action==='preview'){
      const doc=validateModelCostBatch(body.document);
      return{ok:true,json:async()=>({
        code:'wb_model_cost_batch_preview',
        vendorCodes:doc.vendorCodes,costKopecks:doc.costKopecks,
        changedRecords:0,count:doc.vendorCodes.length,token:'test-token'
      })};
    }
    responses.push(body);
    return{ok:true,json:async()=>({
      code:'wb_model_cost_batch_saved',
      changedRecords:body.document.vendorCodes.length
    })};
  };
  const group={id,label:'Lada Vesta',articleCount:codes.length,articles:codes};
  const ok=mountModelCostReview({
    documentRef:{createElement:node},parent,group,post
  });
  return {parent,requests,responses,ok};
}
const flush=async()=>{
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
};
test('rendered group costs are not selected or saved automatically',()=>{
  const f=fixture();
  assert.equal(f.ok,true);
  assert.equal(f.requests.length,0);
  const wrap=f.parent.children[0];
  const form=wrap.children[2];
  const checks=form.children[0].children.map(label=>label.children[0]);
  assert.ok(checks.every(x=>x.checked===false));
  const buttons=form.children.at(-2);
  assert.equal(buttons.children[1].disabled,true);
  assert.match(wrap.children[0].textContent,/Назначить себестоимость/);
});
test('selection of 2 real Vesta SKUs requires owner review and signed preview before POST',async()=>{
  const f=fixture();
  const form=f.parent.children[0].children[2];
  const checkboxes=form.children[0].children.map(label=>label.children[0]);
  const fields=form.children[2].children.map(label=>label.children.at(-1));
  const [cost,date,source,quality]=fields;
  const attestations=form.children.slice(3,6).map(label=>label.children[0]);
  const [previewButton,saveButton]=form.children[6].children;
  checkboxes.forEach(x=>{x.checked=true;});
  cost.value='4200,00';date.value='2026-10-01';
  source.value='Техкарта для этой комплектации';
  quality.value='confirmed';
  attestations.forEach(x=>{x.checked=true;});
  assert.equal(saveButton.disabled,true);
  form.handlers.submit({preventDefault(){}});
  await flush();
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].url,'/api/wb/model-cost-batch');
  assert.equal(f.requests[0].options.credentials,'same-origin');
  assert.equal(JSON.parse(f.requests[0].options.body).action,'preview');
  assert.equal(saveButton.disabled,false);
  assert.match(form.children.at(-1).textContent,/НИЧЕГО ЕЩЁ НЕ СОХРАНЕНО/);
  saveButton.handlers.click();
  await flush();
  assert.equal(f.requests.length,2);
  assert.equal(JSON.parse(f.requests[1].options.body).action,'confirm');
  assert.equal(f.responses.length,1);
  assert.equal(f.responses[0].document.costKopecks,420000);
  assert.match(form.children.at(-1).textContent,/Финансовая D1 подтвердила 2/);
});
test('selection change invalidates signed preview and prevents original confirmation',async()=>{
  const f=fixture();
  const form=f.parent.children[0].children[2];
  const checks=form.children[0].children.map(label=>label.children[0]);
  const fields=form.children[2].children.map(label=>label.children.at(-1));
  const marks=form.children.slice(3,6).map(label=>label.children[0]);
  const [cost,date,source,quality]=fields;
  checks.forEach(x=>{x.checked=true;});
  cost.value='4200';date.value='2026-10-01';
  source.value='Техкарта Vesta';quality.value='confirmed';
  marks.forEach(x=>{x.checked=true;});
  form.handlers.submit({preventDefault(){}});
  await flush();
  const confirm=form.children[6].children[1];
  assert.equal(confirm.disabled,false);
  cost.value='4201';
  cost.handlers.change();
  assert.equal(confirm.disabled,true);
  confirm.handlers.click();
  await flush();
  assert.equal(f.requests.length,1);
});
test('never render batch editing for accessories or unrecognized SKUs',()=>{
  for(const id of ['accessories','unrecognized']){
    const f=fixture({id,codes:['Коврики EVA Vesta']});
    assert.equal(f.ok,false);
    assert.equal(f.parent.children.length,0);
  }
});
