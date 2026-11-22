import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createFinanceProductLinksHandler}=await import(
  '../../functions/api/finance/product-links.js'
);
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const SECRET='test-secret-for-product-links';
const NOW=Date.UTC(2026,10,21,12,5,0);
const draft={
  wbVendorCode:'веста №2',ozonSku:'OZ-VESTA-2',
  verifiedFrom:'2026-11-21',
  evidence:'Сверены фотографии, материал, крой и комплект сидений',
  identicalPhysicalProduct:true,noAutomaticCostTransfer:true
};
function fixture({table=true,owner=true,wbFound=true,ozonFound=true}={}){
  const info={reads:[],writes:[],stored:[]};
  const db={prepare(sql){
    info.reads.push(sql);
    if(sql.includes('office_authorized_users'))
      return {bind(){return{async first(){return owner?{allowed:1}:null;}};}};
    if(sql.includes('sqlite_master'))
      return {async first(){return table?{name:'office_finance_product_links'}:null;}};
    if(sql.startsWith('SELECT wb_vendor_code,ozon_sku,ozon_seller_article'))
      return {async all(){return{results:info.stored.map(x=>({...x}))};}};
    if(sql.startsWith('SELECT sku,seller_article,model FROM ozon_cost_entries'))
      return {bind(sku){
        return{async first(){return ozonFound&&sku===draft.ozonSku?
          {sku,seller_article:'VESTA_BROWN_2',model:'Lada Vesta'}:null;}};
      }};
    if(sql.startsWith('SELECT wb_vendor_code,ozon_sku FROM office_finance_product_links'))
      return {bind(wb,sku){return{async first(){
        return info.stored.find(x=>x.wb_vendor_code===wb||
          x.ozon_sku===sku)||null;
      }};}};
    if(sql.startsWith('INSERT INTO office_finance_product_links'))
      return{bind(wb,sku,article,model,from,evidence,actor){
        return{async first(){
          if(info.stored.some(x=>x.wb_vendor_code===wb||x.ozon_sku===sku))
            return null;
          const record={
            wb_vendor_code:wb,ozon_sku:sku,ozon_seller_article:article,
            model_name:model,verified_from:from,evidence,actor};
          info.writes.push(record);info.stored.push(record);
          return{wb_vendor_code:wb};
        }};
      }};
    throw Error('unexpected Ozon SQL '+sql);
  }};
  const wb={prepare(sql){
    info.reads.push(sql);
    assert.match(sql,/p.status='complete'/);
    return{bind(account,code){
      assert.equal(account,'4271851');assert.equal(code,draft.wbVendorCode);
      return{async first(){return wbFound?{found:1}:null;}};
    }};
  }};
  return{info,env:{
    OFFICE_SESSION_SECRET:SECRET,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:db,WB_REPORT_SNAPSHOT_DB:wb,
    WB_REPORT_ACCOUNT_ID:'4271851'
  }};
}
async function request({method='GET',actor='owner',action='preview',
  document=draft,token=null,origin=ORIGIN,contentType='application/json'}={}){
  const headers={Accept:'application/json'};
  if(actor)headers.Cookie=(await createSession(actor,SECRET)).split(';')[0];
  if(method==='POST'){
    headers.Origin=origin;headers['Content-Type']=contentType;
  }
  return new Request(ORIGIN+'/api/finance/product-links',{
    method,headers,body:method==='POST'?JSON.stringify({action,document,token}):undefined
  });
}
const handler=createFinanceProductLinksHandler({now:()=>NOW});
test('GET returns empty verified registry, not fake links',async()=>{
  const f=fixture();
  const res=await handler({request:await request(),env:f.env});
  assert.equal(res.status,200);
  const b=await res.json();
  assert.deepEqual(b.links,[]);
  assert.equal(b.code,'finance_product_links');
  assert.equal(b.status,'ready');
  assert.equal(b.changedRecords,0);
  assert.equal(f.info.writes.length,0);
});
test('migration missing is explicit and no write attempt occurs',async()=>{
  const f=fixture({table:false});
  const get=await handler({request:await request(),env:f.env});
  assert.equal(get.status,200);
  assert.equal((await get.json()).status,'migration_required');
  const post=await handler({request:await request({method:'POST'}),env:f.env});
  assert.equal(post.status,409);
  assert.equal(f.info.writes.length,0);
});
test('owner preview verifies real marketplace records; signed confirm saves one link without costs',async()=>{
  const f=fixture();
  const preview=await handler({
    request:await request({method:'POST'}),env:f.env
  });
  assert.equal(preview.status,200);
  const p=await preview.json();
  assert.equal(p.code,'finance_product_link_preview');
  assert.equal(p.readOnly,true);
  assert.equal(p.changedRecords,0);
  assert.equal(p.document.modelName,'Lada Vesta');
  assert.equal(p.document.ozonSellerArticle,'VESTA_BROWN_2');
  assert.equal(f.info.writes.length,0);
  const confirm=await handler({
    request:await request({method:'POST',action:'confirm',token:p.token}),
    env:f.env
  });
  assert.equal(confirm.status,200);
  assert.deepEqual(await confirm.json(),{
    code:'finance_product_link_saved',changedRecords:1,
    wbVendorCode:draft.wbVendorCode,ozonSku:draft.ozonSku,
    costTransferred:false
  });
  assert.equal(f.info.writes.length,1);
  assert.equal(f.info.writes[0].model_name,'Lada Vesta');
  const get=await handler({request:await request(),env:f.env});
  const saved=await get.json();
  assert.equal(saved.links.length,1);
  assert.equal(saved.links[0].status,'verified_identity_only');
  assert.ok(!JSON.stringify(saved).includes('owner-test-secret'));
  assert.equal(f.info.reads.some(s=>/UPDATE |DELETE /i.test(s)),false);
  const replay=await handler({
    request:await request({method:'POST',action:'confirm',token:p.token}),
    env:f.env
  });
  assert.equal(replay.status,409);
  assert.equal((await replay.json()).code,'product_link_already_exists');
  assert.equal(f.info.writes.length,1);
});
test('no owner, invalid origin, invalid source and missing attestation cannot save',async()=>{
  const cases=[
    {kind:'auth',opts:{actor:null},config:{},expected:401},
    {kind:'auth',opts:{actor:'outsider'},config:{owner:false},expected:403},
    {kind:'origin',opts:{method:'POST',origin:'https://bad.example'},
      config:{},expected:403},
    {kind:'wb',opts:{method:'POST'},config:{wbFound:false},expected:409},
    {kind:'ozon',opts:{method:'POST'},config:{ozonFound:false},expected:503},
    {kind:'attest',opts:{method:'POST',document:{
      ...draft,identicalPhysicalProduct:false
    }},config:{},expected:400}
  ];
  for(const c of cases){
    const f=fixture(c.config);
    const res=await handler({request:await request(c.opts),env:f.env});
    assert.equal(res.status,c.expected,c.kind);
    assert.equal(f.info.writes.length,0,c.kind);
  }
});
test('changed dates, forged receipts and expired preview fail closed',async()=>{
  const f=fixture();
  const p=await (await handler({request:await request({method:'POST'}),
    env:f.env})).json();
  for(const opts of [
    {token:p.token,document:{...draft,verifiedFrom:'2026-11-22'}},
    {token:'garbage'},
  ]){
    const res=await handler({request:await request({
      method:'POST',action:'confirm',...opts
    }),env:f.env});
    assert.equal(res.status,409);
  }
  const expired=createFinanceProductLinksHandler({now:()=>NOW+600001});
  const result=await expired({request:await request({
    method:'POST',action:'confirm',token:p.token
  }),env:f.env});
  assert.equal(result.status,409);
  assert.equal(f.info.writes.length,0);
});


test('Profit-only Seller SKU can be previewed then stored one-to-one after live source checks',async()=>{
  const f=fixture({ozonFound:false});
  let sellerCalls=0,profitCalls=0;
  const sku='1606894548';
  const fullName='Модельные авточехлы Lada Priora sedan черные с алькантарой и черными сотами: '+('вариант '.repeat(9));
  f.env.OZON_CLIENT_ID='seller-client';
  f.env.OZON_API_KEY='private-key';
  f.env.OZON_FINANCE_SYNC={async getProfitDocument(key){
    profitCalls++;
    assert.equal(key,'costs');
    return{key,target:'ce9dd331-929d-4c3e-9073-368de3346bc9',
      version:9,value:{entries:[{sku,status:'confirmed'}]}};
  }};
  const live=createFinanceProductLinksHandler({now:()=>NOW,
    fetchUpstream:async(url,opts)=>{
      sellerCalls++;
      assert.equal(url,'https://api-seller.ozon.ru/v3/product/info/list');
      assert.equal(opts.method,'POST');
      assert.deepEqual(JSON.parse(opts.body),{sku:[sku]});
      assert.equal(opts.headers['Api-Key'],'private-key');
      return{ok:true,status:200,async json(){return{items:[{
        sku:Number(sku),offer_id:'24604',
        name:fullName,id:817223,is_archived:false
      }]};}};
    }});
  const doc={...draft,ozonSku:sku};
  const preview=await live({request:await request({
    method:'POST',document:doc
  }),env:f.env});
  assert.equal(preview.status,200);
  const value=await preview.json();
  assert.equal(value.code,'finance_product_link_preview');
  assert.equal(value.document.ozonSellerArticle,'24604');
  assert.equal(value.document.ozonProductTitle,fullName);
  assert.equal(value.document.modelName,fullName.slice(0,100).trim());
  assert.equal(value.document.identitySource,'ozon_seller_api_current_catalog');
  assert.equal(f.info.writes.length,0);
  const saved=await live({request:await request({
    method:'POST',action:'confirm',document:doc,token:value.token
  }),env:f.env});
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).costTransferred,false);
  assert.equal(sellerCalls,2);
  assert.equal(profitCalls,2);
  assert.equal(f.info.writes.length,1);
  assert.equal(f.info.writes[0].ozon_sku,sku);
  assert.equal(f.info.writes[0].ozon_seller_article,'24604');
  assert.equal(f.info.writes[0].model_name,fullName.slice(0,100).trim());
  assert.equal(Object.hasOwn(f.info.writes[0],'cost_kopecks'),false);
  assert.equal(f.info.reads.some(x=>/UPDATE |DELETE /i.test(x)),false);
});
test('Profit-only link fails closed if Seller product changes between preview and confirm',async()=>{
  const f=fixture({ozonFound:false});
  const sku='1606894548';let changed=false;
  f.env.OZON_CLIENT_ID='client';f.env.OZON_API_KEY='secret';
  f.env.OZON_FINANCE_SYNC={async getProfitDocument(key){
    return{key,target:'ce9dd331-929d-4c3e-9073-368de3346bc9',
      version:9,value:{entries:[{sku,status:'confirmed'}]}};
  }};
  const live=createFinanceProductLinksHandler({now:()=>NOW,
    fetchUpstream:async()=>({ok:true,status:200,
      async json(){return{items:[{
        sku:Number(sku),offer_id:changed?'OTHER-CARD':'24604',
        name:'Авточехлы Lada Priora',id:123
      }]};}
    })});
  const doc={...draft,ozonSku:sku};
  const preview=await (await live({request:await request({
    method:'POST',document:doc
  }),env:f.env})).json();
  changed=true;
  const res=await live({request:await request({
    method:'POST',action:'confirm',document:doc,token:preview.token
  }),env:f.env});
  assert.equal(res.status,409);
  assert.equal((await res.json()).code,'product_link_preview_changed_or_expired');
  assert.equal(f.info.writes.length,0);
});
test('Seller-only link requires SKU in trusted Profit document, ignores unrelated cards',async()=>{
  const f=fixture({ozonFound:false}),sku='1606894548';
  f.env.OZON_CLIENT_ID='client';f.env.OZON_API_KEY='secret';
  let called=0;
  f.env.OZON_FINANCE_SYNC={async getProfitDocument(key){
    return{key,target:'ce9dd331-929d-4c3e-9073-368de3346bc9',
      version:9,value:{entries:[{sku:'99999',status:'confirmed'}]}};
  }};
  const live=createFinanceProductLinksHandler({now:()=>NOW,
    fetchUpstream:async()=>{called++;throw Error('should not call');}});
  const res=await live({request:await request({
    method:'POST',document:{...draft,ozonSku:sku}
  }),env:f.env});
  assert.equal(res.status,409);
  assert.equal((await res.json()).code,'ozon_profit_sku_not_verified');
  assert.equal(called,0);
  assert.equal(f.info.writes.length,0);
});
test('Seller API rate limit and no matching SKU do not create verified links',async()=>{
  for(const [status,items,want] of [
    [429,null,'ozon_identity_rate_limited'],
    [200,[],'ozon_sku_card_not_found']
  ]){
    const f=fixture({ozonFound:false}),sku='1606894548';
    f.env.OZON_CLIENT_ID='client';f.env.OZON_API_KEY='secret';
    f.env.OZON_FINANCE_SYNC={async getProfitDocument(key){
      return{key,target:'ce9dd331-929d-4c3e-9073-368de3346bc9',
        version:9,value:{entries:[{sku,status:'confirmed'}]}};
    }};
    const live=createFinanceProductLinksHandler({now:()=>NOW,
      fetchUpstream:async()=>({
        status,ok:status===200,async json(){return{items};}
      })});
    const res=await live({request:await request({
      method:'POST',document:{...draft,ozonSku:sku}
    }),env:f.env});
    assert.equal((await res.json()).code,want);
    assert.equal(f.info.writes.length,0);
  }
});
