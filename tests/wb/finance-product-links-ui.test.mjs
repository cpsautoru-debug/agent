import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachFinanceProductLinks}
  from '../../web/office/finance-product-links-ui.mjs';
const ids=['financeLinksLoad','financeLinksStatus','financeLinksForm',
  'financeLinksWb','financeLinksOzon','financeLinksFrom',
  'financeLinksEvidence','financeLinksSame','financeLinksNoCost',
  'financeLinksPreview','financeLinksSave','financeLinksPreviewStatus',
  'financeLinksRows','financeLinksGroupFilter','financeLinksGroupStatus',
  'financeWbCardLookupButton','financeWbCardLookupStatus',
  'financePairRankFilter','financePairSuggestionRows','financePairUnmatched'];
function node(){
  return{
    children:[],textContent:'',value:'',checked:false,disabled:false,
    handlers:{},replaceChildren(...children){this.children=[...children];},
    append(...children){this.children.push(...children);},
    addEventListener(event,fn){this.handlers[event]=fn;}
  };
}
function fixture({migration=false,enrich=false,sellerUnavailable=false,
  grouped=false,contentPermission=true}={}){
  const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
  nodes.financePairRankFilter.value='all';
  const calls=[];
  const registry={code:'finance_product_links',status:'ready',
    readOnly:true,changedRecords:0,links:[],count:0};
  const wb={code:'wb_unit_economics_preview',source:'WB_FINANCE_API_D1',
    scope:'ALL_COMPLETED_WB_REPORTS_NOT_CALENDAR_MONTH',
    articles:[{vendorCode:'веста №2'},{vendorCode:'карты_лада_веста_белые_соты'},
      ...(grouped?[{vendorCode:'чехлы веста черные соты'},
        {vendorCode:'чехлы веста кросс черные'}]:[])]};
  const audit={code:'unified_finance_source_audit',
    ozonCatalog:{entries:[{sku:'OZ-VESTA-2',
      model:'Lada Vesta',sellerArticle:'vesta-brown'},
      ...(grouped?[{sku:'OZ-VESTA-COVER',model:'Lada Vesta',
        sellerArticle:'чехлы-черные-соты'},
        {sku:'OZ-VESTA-CROSS',model:'Lada Vesta Cross',
          sellerArticle:'чехлы-черные-соты'},
        {sku:'OZ-DOOR',model:'Lada Vesta',
          sellerArticle:'карты-белые-соты'}]:[])]},
    ...(enrich?{skuCoverage:{profitOnlySkuCount:1}}:{})};
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
    if(url==='/api/finance/wb-content-cards'){
      if(!contentPermission)return{ok:false,json:async()=>({
        code:'wb_content_scope_required'
      })};
      return{ok:true,json:async()=>({
        code:'wb_content_card_lookup',source:'wb_content_api_live',
        readOnly:true,changedRecords:0,
        totalFinanceCodes:wb.articles.length,matchedCount:1,
        fullyScanned:false,pagesRead:3,
        items:[{vendorCode:'веста №2',
          title:'Модельные авточехлы Lada Vesta с черными сотами',
          physicalIdentityVerified:false,costTransferred:false}],
        unmatched:['карты_лада_веста_белые_соты'],
        physicalIdentityVerified:false
      })};
    }
    if(url==='/api/wb/unit-economics')
      return{ok:true,json:async()=>wb};
    if(url==='/api/finance/cost-audit')
      return{ok:true,json:async()=>audit};
    if(url==='/api/finance/ozon-sku-cards'){
      if(sellerUnavailable)return{ok:false,json:async()=>({
        code:'ozon_seller_api_unavailable'
      })};
      return{ok:true,json:async()=>({
        code:'ozon_sku_cards_lookup',
        readOnly:true,changedRecords:0,
        source:'ozon_seller_api_v3_product_info_list',
        accountScope:'connected_ozon_client_only',
        missingFromLocalCatalog:1,foundCount:1,
        attemptedCount:1,items:[{
          sku:'1606894548',name:'Чехлы Lada Priora черные с алькантарой',
          offerId:'24604',physicalIdentityVerified:false,
          costTransferred:false
        }],notFound:[],unsupported:[]
      })};
    }
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
test('owner-triggered load includes SKU from live Ozon Seller alongside three local cost catalog SKUs',async()=>{
  const f=fixture({enrich:true}),e=f.nodes;
  assert.equal(f.calls.length,0);
  e.financeLinksLoad.handlers.click();
  await flush();
  assert.equal(f.calls.filter(x=>x.url==='/api/finance/ozon-sku-cards').length,1);
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  assert.equal(e.financeLinksOzon.children.length,3);
  assert.equal(e.financeLinksOzon.children[2].value,'OZ-VESTA-2');
  assert.equal(e.financeLinksOzon.children[1].value,'1606894548');
  assert.match(e.financeLinksOzon.children[1].textContent,/Чехлы Lada Priora/);
  assert.match(e.financeLinksStatus.textContent,/всего доступных SKU Ozon: 2/);
  assert.match(e.financeLinksStatus.textContent,/Seller API дополнительно: 1/);
});
test('Seller API unavailable preserves local SKU selections and blocks nonexistent SKU',async()=>{
  const f=fixture({enrich:true,sellerUnavailable:true}),e=f.nodes;
  e.financeLinksLoad.handlers.click();
  await flush();
  assert.equal(e.financeLinksOzon.children.length,2);
  assert.equal(e.financeLinksOzon.children[1].value,'OZ-VESTA-2');
  assert.match(e.financeLinksStatus.textContent,/не удалось проверить/);
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
});
test('group filter narrows both selects without choosing or confirming a physical product',async()=>{
  const f=fixture({grouped:true}),e=f.nodes;
  assert.equal(f.calls.length,0);
  e.financeLinksLoad.handlers.click();
  await flush();
  assert.equal(e.financeLinksGroupFilter.disabled,false);
  assert.equal(e.financeLinksGroupFilter.children.length,4);
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  e.financeLinksGroupFilter.value='vesta|door';
  e.financeLinksGroupFilter.handlers.change('vesta|door');
  assert.equal(e.financeLinksWb.children.length,2);
  assert.equal(e.financeLinksWb.children[1].value,'карты_лада_веста_белые_соты');
  assert.equal(e.financeLinksOzon.children.length,2);
  assert.equal(e.financeLinksOzon.children[1].value,'OZ-DOOR');
  assert.equal(e.financeLinksWb.value,'');
  assert.equal(e.financeLinksOzon.value,'');
  assert.match(e.financeLinksGroupStatus.textContent,/НЕ подтверждено/);
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  // Switching back restores all choices but does not pick a pair.
  e.financeLinksGroupFilter.value='';
  e.financeLinksGroupFilter.handlers.change('');
  assert.equal(e.financeLinksWb.children.length,5);
  assert.equal(e.financeLinksOzon.children.length,5);
  assert.equal(e.financeLinksWb.value,'');
});
test('changing model after preview invalidates signed receipt before save',async()=>{
  const f=fixture({grouped:true}),e=f.nodes;
  e.financeLinksLoad.handlers.click();await flush();
  e.financeLinksWb.value='чехлы веста черные соты';
  e.financeLinksOzon.value='OZ-VESTA-COVER';
  e.financeLinksFrom.value='2026-11-22';
  e.financeLinksEvidence.value='Сверены фото материалы лекала и комплектация';
  e.financeLinksSame.checked=true;e.financeLinksNoCost.checked=true;
  e.financeLinksForm.handlers.submit({preventDefault(){}});
  await flush();
  assert.equal(e.financeLinksSave.disabled,false);
  e.financeLinksGroupFilter.value='vesta-cross|seat';
  e.financeLinksGroupFilter.handlers.change('vesta-cross|seat');
  assert.equal(e.financeLinksSave.disabled,true);
  e.financeLinksSave.handlers.click();
  await flush();
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);
  assert.equal(f.registry.count,0);
});
test('WB card titles are used only after button, make previously unknown model explicit, never auto-save',async()=>{
  const f=fixture({grouped:true}),e=f.nodes;
  assert.equal(f.calls.length,0);
  e.financeLinksLoad.handlers.click();
  await flush();
  assert.equal(f.calls.filter(x=>x.url==='/api/finance/wb-content-cards').length,0);
  assert.equal(e.financeWbCardLookupButton.disabled,false);
  const before=e.financeLinksGroupStatus.textContent;
  assert.match(before,/WB 1/);
  e.financeWbCardLookupButton.handlers.click();
  await flush();
  assert.equal(f.calls.filter(x=>x.url==='/api/finance/wb-content-cards').length,1);
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  assert.match(e.financeWbCardLookupStatus.textContent,/Точные карточки WB прочитаны/);
  assert.equal(e.financePairSuggestionRows.children[0].children[5].children[0].disabled,false,
    'review action is enabled after Content API enrichment');
  assert.match(e.financeWbCardLookupStatus.textContent,/не считаются отсутствующими/);
  assert.match(e.financeLinksGroupStatus.textContent,/WB 0/);
  assert.equal(e.financeLinksWb.value,'');
  assert.equal(e.financeLinksSave.disabled,true);
  assert.equal(f.registry.count,0);
});
test('no WB Content permission retains safe existing groups, no fake classification',async()=>{
  const f=fixture({grouped:true,contentPermission:false}),e=f.nodes;
  e.financeLinksLoad.handlers.click();
  await flush();
  const before=e.financeLinksGroupStatus.textContent;
  e.financeWbCardLookupButton.handlers.click();
  await flush();
  assert.match(e.financeWbCardLookupStatus.textContent,/отклонил доступ/);
  assert.equal(e.financeLinksGroupStatus.textContent,before);
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  assert.equal(e.financeLinksSave.disabled,true);
});
test('form is strictly no-cost, source-bound, and has one instance of each control',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/finance-product-links-ui.mjs',import.meta.url),'utf8');
  for(const id of ['financeProductLinksPanel',...ids])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert.match(html,/finance-product-links-ui\.mjs\?v=20261122-review-buttons-fix/);
  assert.match(html,/номер[а-я ]*техкарты/i);
  assert.ok(!ui.includes('costKopecks='));
  assert.ok(!ui.includes('innerHTML'));
});

test('review table filters without POST and choosing hint clears attestations',async()=>{
  const f=fixture({grouped:true}),e=f.nodes;
  e.financeLinksLoad.handlers.click();await flush();
  assert.ok(e.financePairSuggestionRows.children.length>0);
  assert.match(e.financePairSuggestionRows.children[0].children[2].textContent,/\/100/);
  e.financePairRankFilter.value='high';
  e.financePairRankFilter.handlers.change('high');
  assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
  e.financePairRankFilter.value='all';
  e.financePairRankFilter.handlers.change('all');
  const match=e.financePairSuggestionRows.children.find(row=>
    row.children[5]?.children[0]?.handlers?.click);
  assert.ok(match);
  assert.equal(match.children[5].children[0].disabled,false,
    'review action is enabled after initial catalog loading');
  e.financeLinksSame.checked=true;e.financeLinksNoCost.checked=true;
  e.financeLinksEvidence.value='do not preserve';
  match.children[5].children[0].handlers.click();
  assert.equal(e.financeLinksSame.checked,false);
  assert.equal(e.financeLinksNoCost.checked,false);
  assert.equal(e.financeLinksEvidence.value,'');
  assert.equal(e.financeLinksSave.disabled,true);
  assert.match(e.financeLinksPreviewStatus.textContent,/Ничего не сохранено/);
  assert.equal(f.registry.count,0);
});
