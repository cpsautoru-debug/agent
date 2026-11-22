import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createWbContentCardLookupHandler}=await import(
  '../../functions/api/finance/wb-content-cards.js'
);
const SECRET='wb-content-card-test-secret';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
function fixture({owner=true,token='content-token',status=200,total=1}={}){
  const commands=[],calls=[];
  const finance={
    prepare(sql){
      commands.push(sql);
      assert.match(sql,/FROM wb_finance_api_rows/);
      return{bind(account){assert.equal(account,'4271851');
        return{async all(){return{results:[
          {vendorCode:'веста №2'},
          {vendorCode:'карты_лада_веста_белые_соты'}
        ]};}};
      }};
    }
  };
  const office={
    prepare(sql){
      commands.push(sql);
      assert.match(sql,/office_authorized_users/);
      return{bind(){return{async first(){
        return owner?{allowed:1}:null;
      }};}};
    }
  };
  const env={
    OFFICE_SESSION_SECRET:SECRET,
    OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:office,
    WB_REPORT_SNAPSHOT_DB:finance,
    WB_REPORT_ACCOUNT_ID:'4271851',
    WB_CONTENT_API_TOKEN:token
  };
  const fetchUpstream=async(url,args)=>{
    calls.push({url,args});
    return{ok:status===200,status,async json(){
      return{cards:total?[{
        vendorCode:'веста №2',title:'Модельные авточехлы Lada Vesta',
        nmID:12345,subjectName:'Авточехлы'
      }]:[],cursor:{total}};
    }};
  };
  return{env,commands,calls,fetchUpstream};
}
async function req(actor='owner'){
  const headers={};
  if(actor)headers.Cookie=(await createSession(actor,SECRET)).split(';')[0];
  return new Request(ORIGIN+'/api/finance/wb-content-cards',{headers});
}
test('read-only exact WB finance codes and one content page, never changes D1',async()=>{
  const f=fixture();
  const handler=createWbContentCardLookupHandler({
    fetchUpstream:f.fetchUpstream,wait:async()=>{}
  });
  const result=await handler({request:await req(),env:f.env});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.code,'wb_content_card_lookup');
  assert.equal(body.source,'wb_content_api_live');
  assert.equal(body.readOnly,true);
  assert.equal(body.changedRecords,0);
  assert.equal(body.matchedCount,1);
  assert.equal(body.totalFinanceCodes,2);
  assert.equal(body.fullyScanned,true);
  assert.equal(body.items[0].title,'Модельные авточехлы Lada Vesta');
  assert.equal(body.items[0].physicalIdentityVerified,false);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'https://content-api.wildberries.ru/content/v2/get/cards/list');
  assert.equal(f.calls[0].args.method,'POST');
  assert.equal(f.calls[0].args.headers.Authorization,'content-token');
  assert.deepEqual(JSON.parse(f.calls[0].args.body),{
    settings:{sort:{ascending:true},filter:{withPhoto:-1},
      cursor:{limit:100}}
  });
  assert.equal(f.commands.some(x=>/UPDATE |DELETE |INSERT /i.test(x)),false);
  assert.doesNotMatch(JSON.stringify(body),/content-token|owner@example.invalid/);
});
test('without Content scope or token returns blocker, not fabricated card names',async()=>{
  for(const [token,status,code] of [
    ['',200,'wb_content_token_not_configured'],
    ['financial-token',403,'wb_content_scope_required']
  ]){
    const f=fixture({token,status});
    const result=await createWbContentCardLookupHandler({
      fetchUpstream:f.fetchUpstream
    })({request:await req(),env:f.env});
    const b=await result.json();
    assert.equal(b.code,code);
    assert.equal(result.status,token?403:503);
    assert.equal(f.calls.length,token?1:0);
  }
});
test('unauthenticated and non-owner cannot see or load WB content',async()=>{
  for(const [actor,owner,status] of [
    [null,true,401],['other',false,403]
  ]){
    const f=fixture({owner});
    const res=await createWbContentCardLookupHandler({
      fetchUpstream:f.fetchUpstream
    })({request:await req(actor),env:f.env});
    assert.equal(res.status,status);
    assert.equal(f.calls.length,0);
  }
});
test('rate limit blocks, no replay or unauthorized mutation',async()=>{
  const f=fixture({status:429});
  const handler=createWbContentCardLookupHandler({
    fetchUpstream:f.fetchUpstream
  });
  const res=await handler({request:await req(),env:f.env});
  assert.equal(res.status,429);
  assert.equal((await res.json()).code,'wb_content_api_rate_limited');
});
