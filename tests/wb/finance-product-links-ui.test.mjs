import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachFinanceProductLinks}
  from '../../web/office/finance-product-links-ui.mjs';
const ids=['financeLinksLoad','financeLinksStatus','financeLinksForm',
  'financeLinksWb','financeLinksOzon','financeLinksFrom',
  'financeLinksEvidence','financeLinksSame','financeLinksNoCost',
  'financeLinksPreview','financeLinksSave','financeLinksPreviewStatus',
  'financeLinksRows'];
function node(){
  return{
    children:[],textContent:'',value:'',checked:false,disabled:false,
    handlers:{},replaceChildren(...children){this.children=[...children];},
    append(...children){this.children.push(...children);},
    addEventListener(event,fn){this.handlers[event]=fn;}
  };
}
function fixture({migration=false}={}){
  const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
  const calls=[];
  const registry={code:'finance_product_links',status:'ready',
    readOnly:true,changedRecords:0,links:[],count:0};
  const wb={code:'wb_unit_economics_preview',source:'WB_FINANCE_API_D1',
    scope:'ALL_COMPLETED_WB_REPORTS_NOT_CALENDAR_MONTH',
    articles:[{vendorCode:'веста №2'},{vendorCode:'карты_лада_веста_белые_соты'}]};
  const audit={code:'unified_finance_source_audit',
    ozonCatalog:{entries:[{sku:'OZ-VESTA-2',
      model:'Lada Vesta',sellerArticle:'vesta-brown'}]}};
  const fetchData=async(url,options)=>{
    calls.push({url,options});
    if(url==='/api/finance/product-links'){
      if(options.method==='GET')
        return{ok:true,json:async()=>migration?{
          code:'finance_product_links_migration_required',
          status:'migration_required',readOnly:true,changedRecords:0
        }:registry};
      const body=JSON.parse(options.body);
      if(body.action==='preview')return{ok:true,json:async()=>({
        code:'finance_product_link_preview',readOnly:true,changedRecords:0,
        document:{...body.document,modelName:'Lada Vesta'},
        token:'signed-test-receipt'
      })};
      if(body.action==='confirm'){
        registry.links.push({
          wbVendorCode:body.document.wbVendorCode,
          ozonSku:body.document.ozonSku,
          modelName:'Lada Vesta',verifiedFrom:body.document.verifiedFrom
        });
        registry.count=registry.links.length;
        return{ok:true,json:async()=>({
          code:'finance_product_link_saved',
          changedRecords:1,costTransferred:false
        })};
      }
    }
    if(url==='/api/wb/unit-economics')
      return{ok:true,json:async()=>wb};
    if(url==='/api/finance/cost-audit')
      return{ok:true,json:async()=>audit};
    throw Error('unexpected URL '+url);
  };
  const documentRef={getElementById(id){return nodes[id]||null;},
    createElement(){return node();}};
  assert.equal(attachFinanceProductLinks({documentRef,fetchData}),true);
  return{nodes,calls,registry};
}
const flush=async()=>{
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
};
test('no automatic source fetch or writing on mount',()=>{
  const f=fixture();
  assert.equal(f.calls.length,0);
  assert.equal(f.nodes.financeLinksPreview.disabled,false);
  assert.equal(f.nodes.financeLinksSave.disabled,false);
  f.nodes.financeLinksLoad.handlers.click();
  return flush().then(()=>{
    assert.equal(f.calls.filter(x=>x.options.method==='GET').length,3);
    assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
    assert.equal(f.nodes.financeLinksSave.disabled,true);
    assert.equal(f.nodes.financeLinksWb.children.length,3);
    assert.equal(f.nodes.financeLinksOzon.children.length,2);
  });
});
test('migration missing blocks all links and does not fake an empty ready registry',async()=>{
  const f=fixture({migration:true});
  f.nodes.financeLinksLoad.handlers.click();
  await flush();
  assert.match(f.nodes.financeLinksStatus.textContent,/миграцию 0005/);
  assert.equal(f.calls.length,1);
  assert.equal(f.nodes.financeLinksPreview.disabled,true);
  assert.equal(f.nodes.financeLinksSave.disabled,true);
});
test('verified owner-only preview and save require separate deliberate actions',async()=>{
  const f=fixture(),e=f.nodes;
  e.financeLinksLoad.handlers.click();
  await flush();
  e.financeLinksWb.value='веста №2';
  e.financeLinksOzon.value='OZ-VESTA-2';
  e.financeLinksFrom.value='2026-11-21';
  e.financeLinksEvidence.value='Сверены фотографии, материал, крой и комплектация';
  e.financeLinksSame.checked=true;
  e.financeLinksNoCost.checked=true;
  e.financeLinksForm.handlers.submit({preventDefault(){}});
  await flush();
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);
  assert.equal(JSON.parse(f.calls.at(-1).options.body).action,'preview');
  assert.match(e.financeLinksPreviewStatus.textContent,/НИЧЕГО НЕ СОХРАНЕНО/);
  assert.equal(e.financeLinksSave.disabled,false);
  e.financeLinksSave.handlers.click();
  await flush();
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,2);
  assert.equal(JSON.parse(f.calls.filter(x=>x.options.method==='POST')[1].options.body).action,'confirm');
  assert.equal(f.registry.count,1);
  assert.equal(e.financeLinksRows.children.length,1);
  assert.equal(e.financeLinksSave.disabled,true);
  assert.equal(f.calls.filter(x=>x.url==='/api/wb/unit-economics').length,2);
});
test('invalid draft does not call a POST or claim a saved link',async()=>{
  const f=fixture();
  f.nodes.financeLinksLoad.handlers.click();
  await flush();
  f.nodes.financeLinksForm.handlers.submit({preventDefault(){}});
  await flush();
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  assert.match(f.nodes.financeLinksPreviewStatus.textContent,/Укажи артикул/);
});
test('form is strictly no-cost, source-bound, and has one instance of each control',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/finance-product-links-ui.mjs',import.meta.url),'utf8');
  for(const id of ['financeProductLinksPanel',...ids])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert.match(html,/finance-product-links-ui\.mjs/);
  assert.match(html,/номер[а-я ]*техкарты/i);
  assert.ok(!ui.includes('costKopecks='));
  assert.ok(!ui.includes('innerHTML'));
});
