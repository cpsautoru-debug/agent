import test from 'node:test';
import assert from 'node:assert/strict';
import {renderUnifiedCostAudit,attachUnifiedCostAudit}
  from '../../web/office/finance-cost-audit.mjs';
import {readFileSync} from 'node:fs';
import {auditOzonProfitSkuCoverage} from '../../web/office/finance-profit-coverage-core.mjs';
const ids=['financeAuditRefresh','financeAuditStatus','financeAuditCostRows',
  'financeAuditExpenseRows','financeAuditWbCount',
  'financeAuditOzonCatalogCount','financeAuditProfitCount',
  'financeAuditExpenseCount','financeAuditScope','financeAuditWarnings',
  'financeAuditUniqueProfitSkus','financeAuditProfitOnlySkus',
  'financeAuditCatalogOnlySkus','financeAuditIntersectSkus',
  'financeAuditProfitOnlyRows','financeAuditSkuCoverageNote',
  'financeAuditOverheadReview'];
const node=()=>({
  textContent:'',disabled:false,children:[],handlers:{},
  append(x){this.children.push(x);},
  replaceChildren(){this.children=[];},
  addEventListener(name,fn){this.handlers[name]=fn;}
});
const sample={
  code:'unified_finance_source_audit',readOnly:true,changedRecords:0,
  source:'WB_D1_PLUS_OZON_COSTS_PLUS_OZON_PROFIT_RPC',netProfitKopecks:null,
  canonicalSharedCatalogReady:false,
  wb:{status:'ready',count:1,confirmed:0,entries:[{
    vendorCode:'веста №2',validFrom:'2026-08-30',validTo:null,
    costKopecks:420000,status:'preliminary'
  }]},
  ozonCatalog:{count:1,confirmed:1,entries:[{
    sku:'OZ-1',sellerArticle:'веста коричневая',model:'Lada Vesta',
    costKopecks:420000,status:'confirmed'
  }]},
  ozonProfit:{status:'ready',version:3,count:1,confirmed:1,
    entries:[{sku:'OZ-1',validFrom:'2026-08-01',validTo:null,
      costKopecks:420000,status:'confirmed'}]},
  expenses:{status:'ready',version:2,configuredCount:1,
    items:[{id:'rent',label:'Аренда',scope:'business',
      amountKopecks:5000000,leatherDelivery:false,
      validFrom:'2026-11-01',validTo:null}]},
  possibleArticleLinks:[],ozonProfitCrosschecks:[],
  blockers:['wb_ozon_link_not_confirmed','tax_registry_not_integrated',
    'shared_expense_allocation_not_integrated']
};
sample.skuCoverage=auditOzonProfitSkuCoverage({
  profitEntries:[{...sample.ozonProfit.entries[0],
    leatherDeliveryIncluded:null}],
  catalogEntries:sample.ozonCatalog.entries,
  expenses:sample.expenses.items
});
function fixture(){
  const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
  const documentRef={
    visibilityState:'visible',
    getElementById(id){return nodes[id]||null;},
    createElement(){return node();},
    handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}
  };
  const windowRef={location:{hash:'#wbFinance'},
    handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}};
  return {nodes,documentRef,windowRef};
}
test('real preliminary WB cost, Ozon sources and business expenses render separately',()=>{
  const {nodes,documentRef}=fixture();
  renderUnifiedCostAudit(documentRef,sample);
  assert.equal(nodes.financeAuditWbCount.textContent,'0 / 1');
  assert.equal(nodes.financeAuditOzonCatalogCount.textContent,'1 / 1');
  assert.equal(nodes.financeAuditProfitCount.textContent,'1 / 1');
  assert.equal(nodes.financeAuditExpenseCount.textContent,'1');
  assert.equal(nodes.financeAuditCostRows.children.length,3);
  assert.match(nodes.financeAuditCostRows.children[0].children[1].textContent,
    /веста №2/);
  assert.match(nodes.financeAuditCostRows.children[0].children[4].textContent,
    /Предварительная/);
  assert.equal(nodes.financeAuditExpenseRows.children.length,1);
  assert.equal(nodes.financeAuditUniqueProfitSkus.textContent,'1');
  assert.equal(nodes.financeAuditProfitOnlySkus.textContent,'0');
  assert.equal(nodes.financeAuditCatalogOnlySkus.textContent,'0');
  assert.equal(nodes.financeAuditIntersectSkus.textContent,'1');
  assert.equal(nodes.financeAuditProfitOnlyRows.children.length,1);
  assert.match(nodes.financeAuditOverheadReview.textContent,/Не|не распределена/);
  assert.match(nodes.financeAuditExpenseRows.children[0].children[1].textContent,
    /Общая для бизнеса/);
  assert.match(nodes.financeAuditWarnings.textContent,/Налоговый регистр/);
  assert.match(nodes.financeAuditStatus.textContent,/не чистая прибыль/);
});
test('unavailable Ozon Profit RPC is not represented as zero verified costs',()=>{
  const {nodes,documentRef}=fixture();
  renderUnifiedCostAudit(documentRef,{
    ...sample,ozonProfit:{...sample.ozonProfit,status:'unavailable',entries:[]},
    expenses:{...sample.expenses,status:'unavailable',items:[]}
  });
  assert.equal(nodes.financeAuditProfitCount.textContent,'Источник недоступен');
  assert.equal(nodes.financeAuditExpenseCount.textContent,'Источник недоступен');
});
test('unexpected server claims or missing keys are rejected before showing money',()=>{
  const {documentRef}=fixture();
  for(const data of [
    {...sample,netProfitKopecks:1200},
    {...sample,canonicalSharedCatalogReady:true},
    {...sample,changedRecords:1},
    {...sample,wb:{...sample.wb,status:'none'}},
    {...sample,ozonCatalog:{...sample.ozonCatalog,entries:undefined}}
  ])assert.throws(()=>renderUnifiedCostAudit(documentRef,data));
});
test('owner panel only uses GET while visible on finance WB route',async()=>{
  const {nodes,documentRef,windowRef}=fixture();
  const calls=[];
  const fetchSource=async(url,options)=>{
    calls.push({url,options});
    return{ok:true,json:async()=>sample};
  };
  assert.equal(attachUnifiedCostAudit({
    documentRef,windowRef,fetchSource,now:()=>1000000
  }),true);
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/finance/cost-audit');
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.credentials,'same-origin');
  assert.equal(nodes.financeAuditWbCount.textContent,'0 / 1');
  windowRef.handlers.hashchange();
  for(let i=0;i<2;i++)await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);
  windowRef.location.hash='#ozonProfit';
  nodes.financeAuditRefresh.handlers.click();
  for(let i=0;i<2;i++)await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,1);
});
test('profit-only dated versions are shown as SKU with unknown seller article, not product mapping',()=>{
  const {nodes,documentRef}=fixture();
  const coverage=auditOzonProfitSkuCoverage({
    profitEntries:[{sku:'UNLINKED-123',validFrom:'2026-10-01',
      validTo:null,costKopecks:420000,status:'confirmed',
      leatherDeliveryIncluded:true}],
    catalogEntries:[],expenses:[{id:'del',label:'Доставка кожи',
      scope:'business',amountKopecks:200000,
      validFrom:'2026-10-01',validTo:null,leatherDelivery:true}]
  });
  renderUnifiedCostAudit(documentRef,{
    ...sample,skuCoverage:coverage,
    ozonProfit:{...sample.ozonProfit,entries:[],
      count:1,confirmed:1},
    ozonCatalog:{...sample.ozonCatalog,entries:[],
      count:0,confirmed:0},
    expenses:{...sample.expenses,
      items:[{id:'del',label:'Доставка кожи',
        scope:'business',amountKopecks:200000,
        validFrom:'2026-10-01',validTo:null}]}
  });
  assert.equal(nodes.financeAuditUniqueProfitSkus.textContent,'1');
  assert.equal(nodes.financeAuditProfitOnlySkus.textContent,'1');
  assert.equal(nodes.financeAuditProfitOnlyRows.children[0].children[0].textContent,
    'UNLINKED-123');
  assert.match(nodes.financeAuditExpenseRows.children[0].children[4].textContent,/Риск дубля/);
  assert.match(nodes.financeAuditOverheadReview.textContent,/специальной сверки доставки материалов: 1/);
});
test('new UI does not invent save controls or mutate finance databases',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/finance-cost-audit.mjs',import.meta.url),'utf8');
  for(const id of ['financeCostAudit',...ids])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert.match(html,/finance-cost-audit\.mjs\?v=20261122-sku-coverage/);
  assert.match(html,/Единый контроль себестоимости и общих расходов/);
  assert.doesNotMatch(ui,/method:'POST'|\/api\/wb\/model-cost-batch|innerHTML/);
});
