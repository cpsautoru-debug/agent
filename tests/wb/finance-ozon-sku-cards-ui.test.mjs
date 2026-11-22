import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachOzonSkuLookup}
  from '../../web/office/finance-ozon-sku-cards.mjs';
const node=()=>({
  textContent:'',disabled:false,children:[],handlers:{},
  append(x){this.children.push(x);},
  replaceChildren(){this.children=[];},
  addEventListener(type,cb){this.handlers[type]=cb;}
});
const payload={
  code:'ozon_sku_cards_lookup',readOnly:true,changedRecords:0,
  source:'ozon_seller_api_v3_product_info_list',
  accountScope:'connected_ozon_client_only',
  missingFromLocalCatalog:2,attemptedCount:2,foundCount:1,
  profitVersion:9,
  items:[{sku:'1606894548',name:'Авточехлы Priora',
    offerId:'priora_eco',archived:false,
    physicalIdentityVerified:false,costTransferred:false}],
  notFound:['1710475340'],unsupported:[]
};
function fixture({badPayload=false,error=null}={}){
  const nodes=Object.fromEntries([
    'financeOzonSkuLookupButton','financeOzonSkuLookupStatus',
    'financeOzonSkuLookupRows'].map(k=>[k,node()]));
  const documentRef={getElementById(id){return nodes[id]||null;},
    createElement(){return node();}};
  const windowRef={location:{hash:'#wbFinance'}};
  const calls=[];
  const fetchData=async(url,options)=>{
    calls.push({url,options});
    if(error)return {ok:false,json:async()=>({code:error})};
    return {ok:true,json:async()=>badPayload?
      {...payload,changedRecords:1}:payload};
  };
  assert.equal(attachOzonSkuLookup({documentRef,windowRef,fetchData}),true);
  return {nodes,windowRef,calls};
}
const flush=async()=>{
  for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));
};
test('does not fetch product metadata until owner presses button',async()=>{
  const f=fixture();
  assert.equal(f.calls.length,0);
  f.nodes.financeOzonSkuLookupButton.handlers.click();
  await flush();
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'/api/finance/ozon-sku-cards');
  assert.equal(f.calls[0].options.method,'GET');
  assert.equal(f.calls[0].options.credentials,'same-origin');
  assert.equal(f.nodes.financeOzonSkuLookupRows.children.length,2);
  assert.equal(f.nodes.financeOzonSkuLookupRows.children[0].children[1].textContent,
    'Авточехлы Priora');
  assert.equal(f.nodes.financeOzonSkuLookupRows.children[1].children[3].textContent,
    'Не сопоставлять автоматически');
  assert.match(f.nodes.financeOzonSkuLookupStatus.textContent,
    /найдено 1, отсутствуют в подключённом кабинете 1/);
});
test('outside finance WB route cannot request current seller catalog',async()=>{
  const f=fixture();
  f.windowRef.location.hash='#ozonProfit';
  f.nodes.financeOzonSkuLookupButton.handlers.click();
  await flush();
  assert.equal(f.calls.length,0);
});
test('upstream error and forged read/write claims are rejected without rendering money',async()=>{
  for(const args of [{error:'ozon_seller_api_rate_limited'},{badPayload:true}]){
    const f=fixture(args);
    f.nodes.financeOzonSkuLookupButton.handlers.click();
    await flush();
    assert.equal(f.nodes.financeOzonSkuLookupRows.children.length,0);
    assert.match(f.nodes.financeOzonSkuLookupStatus.textContent,
      /ограничил|не удалось/i);
  }
});
test('only known static source script is included, no injection or mutation controls',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/finance-ozon-sku-cards.mjs',import.meta.url),'utf8');
  for(const id of ['financeOzonSkuLookupButton','financeOzonSkuLookupStatus',
    'financeOzonSkuLookupRows'])
    assert.equal(html.split('id="'+id+'"').length-1,1);
  assert.match(html,/finance-ozon-sku-cards\.mjs\?v=20261122/);
  assert.doesNotMatch(ui,/innerHTML|method:'POST'|\/api\/ozon\/costs.*POST/);
});
