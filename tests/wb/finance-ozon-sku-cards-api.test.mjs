import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createOzonSkuCardsHandler}=await import('../../functions/api/finance/ozon-sku-cards.js');
const SECRET='sku-cards-test-secret';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const TARGET='ce9dd331-929d-4c3e-9073-368de3346bc9';
const sku='1606894548';
function fixture({owner=true,rateLimit=false,unknown=false,unavailable=false}={}){
  const commands=[],api=[];
  const db={prepare(sql){
    commands.push(sql);
    if(sql.includes('office_authorized_users'))
      return{bind(){return{async first(){return owner?{allowed:1}:null;}};}};
    if(sql.startsWith('SELECT sku FROM ozon_cost_entries'))
      return{async all(){return{results:[{sku:'123'}]};}};
    throw Error('unexpected DB read');
  }};
  const env={
    OFFICE_SESSION_SECRET:SECRET,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:db,OZON_CLIENT_ID:'client-test',
    OZON_API_KEY:'api-secret-test',
    OZON_FINANCE_SYNC:{async getProfitDocument(key){
      assert.equal(key,'costs');
      return{key,target:TARGET,version:9,value:{entries:[
        {sku,validFrom:'2026-10-01',validTo:null},
        {sku:'123',validFrom:'2026-10-01',validTo:null}
      ]}};
    }}
  };
  const fetchUpstream=async(url,options)=>{
    api.push({url,options});
    if(unavailable)throw Error('network secret');
    if(rateLimit)return{status:429,ok:false};
    return{status:200,ok:true,async json(){return {items:unknown?[]:[
      {sku:Number(sku),name:'Чехлы Lada Priora',offer_id:'priora-new',
        id:555,is_archived:false}
    ]};}};
  };
  return{env,commands,api,fetchUpstream};
}
async function request(actor='owner',method='GET',query=''){
  const headers={Accept:'application/json'};
  if(actor)headers.Cookie=(await createSession(actor,SECRET)).split(';')[0];
  return new Request(ORIGIN+'/api/finance/ozon-sku-cards'+query,{method,headers});
}
const make=(f)=>createOzonSkuCardsHandler({
  fetchUpstream:f.fetchUpstream,now:()=>Date.UTC(2026,10,22,15)
});
test('owner one-click GET reads Profit cost version and exactly one Ozon Seller API POST, no DB writes',async()=>{
  const f=fixture();
  const res=await make(f)({request:await request(),env:f.env});
  assert.equal(res.status,200);
  const payload=await res.json();
  assert.equal(res.headers.get('Cache-Control'),'private, no-store');
  assert.equal(payload.code,'ozon_sku_cards_lookup');
  assert.equal(payload.readOnly,true);
  assert.equal(payload.changedRecords,0);
  assert.equal(payload.profitVersion,9);
  assert.equal(payload.missingFromLocalCatalog,1);
  assert.equal(payload.attemptedCount,1);
  assert.equal(payload.foundCount,1);
  assert.equal(payload.items[0].name,'Чехлы Lada Priora');
  assert.equal(payload.items[0].offerId,'priora-new');
  assert.equal(payload.items[0].physicalIdentityVerified,false);
  assert.equal(f.api.length,1);
  assert.equal(f.api[0].url,'https://api-seller.ozon.ru/v3/product/info/list');
  assert.equal(f.api[0].options.method,'POST');
  assert.deepEqual(JSON.parse(f.api[0].options.body),{sku:[sku]});
  assert.ok(f.commands.every(sql=>sql.startsWith('SELECT ')));
  assert.doesNotMatch(JSON.stringify(payload),/api-secret-test|owner@example.invalid/);
});
test('unauthorized users cannot read Product/Profit or call Ozon Seller API',async()=>{
  for(const [actor,owner,status] of [
    [null,true,401],['outsider',false,403]
  ]){
    const f=fixture({owner});
    const res=await make(f)({request:await request(actor),env:f.env});
    assert.equal(res.status,status);
    assert.equal(f.api.length,0);
    assert.equal(f.commands.filter(x=>x.includes('ozon_cost_entries')).length,0);
  }
});
test('unknown SKU is explicitly unresolved, not treated as empty catalog',async()=>{
  const f=fixture({unknown:true});
  const res=await make(f)({request:await request(),env:f.env});
  const payload=await res.json();
  assert.equal(res.status,200);
  assert.equal(payload.foundCount,0);
  assert.deepEqual(payload.notFound,[sku]);
  assert.equal(payload.accountScope,'connected_ozon_client_only');
});
test('429 and Ozon transport failure are explicit without pretending prices missing',async()=>{
  for(const [args,status,code] of [
    [{rateLimit:true},429,'ozon_seller_api_rate_limited'],
    [{unavailable:true},503,'ozon_seller_api_network_unavailable']
  ]){
    const f=fixture(args);
    const res=await make(f)({request:await request(),env:f.env});
    assert.equal(res.status,status);
    assert.equal((await res.json()).code,code);
  }
});
test('invalid scope, forbidden method and missing config never call Seller API',async()=>{
  const f=fixture();
  for(const [method,query,status] of [
    ['POST','',405],['GET','?debug=1',400]
  ]){
    const res=await make(f)({
      request:await request('owner',method,query),env:f.env
    });
    assert.equal(res.status,status);
  }
  const env={...f.env,OZON_API_KEY:undefined};
  const res=await make(f)({request:await request(),env});
  assert.equal(res.status,503);
  assert.equal((await res.json()).code,'ozon_sku_lookup_not_configured');
  assert.equal(f.api.length,0);
});
