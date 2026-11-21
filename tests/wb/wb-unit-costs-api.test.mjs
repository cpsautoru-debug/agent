import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createWbCostEntryHandler}=await import('../../functions/api/wb/unit-costs.js');
const ORIGIN='https://autosklad63-office-staging.pages.dev',
  account='4271851',secret='wb-owner-test-secret',NOW=Date.UTC(2026,10,21,6,0);
const doc={
  vendor_code:'VESTA-1',valid_from:'2026-10-01',valid_to:null,
  cost_kopecks:420000,status:'confirmed',
  source:'Материал и расценки швеи/закройщика проверены'
};
function fixture({vendorExists=true,costExists=false,allowed=true}={}){
  const writes=[],queries=[];
  const owner={prepare(sql){
    queries.push(sql);
    return{bind(sub,email){
      assert.equal(email,'owner@example.invalid');
      return{async first(){return allowed&&sub==='owner'?{allowed:1}:null;}};
    }};
  }};
  const wb={prepare(sql){
    queries.push(sql);
    if(sql.startsWith('SELECT 1 AS present FROM wb_finance_api_rows')){
      return{bind(id,code){
        assert.equal(id,account);assert.equal(code,'VESTA-1');
        return{async first(){return vendorExists?{present:1}:null;}};
      }};
    }
    if(sql.startsWith('SELECT 1 AS present FROM wb_profit_unit_costs')){
      return{bind(id,code,from){
        assert.equal(id,account);assert.equal(code,'VESTA-1');
        assert.equal(from,'2026-10-01');
        return{async first(){return costExists?{present:1}:null;}};
      }};
    }
    if(sql.startsWith('INSERT INTO wb_profit_unit_costs')){
      return{bind(...args){return{async run(){
        writes.push(args);return{success:true};
      }}; }};
    }
    throw Error('Unexpected SQL '+sql);
  }};
  return{writes,queries,env:{
    OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:owner,WB_REPORT_SNAPSHOT_DB:wb,
    WB_REPORT_ACCOUNT_ID:account
  }};
}
async function req(body,sub='owner',origin=ORIGIN){
  const headers={'Content-Type':'application/json',Origin:origin};
  if(sub)headers.Cookie=(await createSession(sub,secret)).split(';')[0];
  return new Request(ORIGIN+'/api/wb/unit-costs',{
    method:'POST',headers,body:JSON.stringify(body)
  });
}
const handler=createWbCostEntryHandler({now:()=>NOW});
test('COGS signed preview is read-only; explicit confirm creates immutable dated version',async()=>{
  const f=fixture();
  const first=await handler({request:await req({
    action:'preview',document:doc,explicitlyConfirmed:true
  }),env:f.env});
  assert.equal(first.status,200);
  const preview=await first.json();
  assert.equal(preview.code,'wb_cost_preview');
  assert.equal(preview.changedRecords,0);
  assert.equal(preview.cost.costKopecks,420000);
  assert.equal(typeof preview.token,'string');
  assert.ok(preview.reminder.includes('швею'));
  assert.equal(f.writes.length,0);
  const second=await handler({request:await req({
    action:'confirm',document:doc,explicitlyConfirmed:true,token:preview.token
  }),env:f.env});
  assert.equal(second.status,200);
  assert.deepEqual(await second.json(),{
    code:'wb_cost_saved',vendorCode:'VESTA-1',validFrom:'2026-10-01',
    status:'confirmed',changedRecords:1
  });
  assert.equal(f.writes.length,1);
  assert.deepEqual(f.writes[0].slice(0,7),[
    account,'VESTA-1','2026-10-01',null,420000,'confirmed',doc.source
  ]);
  assert.equal(f.writes[0][7],'owner');
});
test('no foreign origin, unverified owner or implicit cost writes',async()=>{
  for(const [owner,orig,status] of [
    ['owner','https://evil.example',403],
    [null,ORIGIN,401],['not-owner',ORIGIN,403]
  ]){
    const f=fixture();
    const r=await handler({request:await req({
      action:'confirm',document:doc,explicitlyConfirmed:true,token:'invalid'
    },owner,orig),env:f.env});
    assert.equal(r.status,status);
    assert.equal(f.writes.length,0);
  }
  const f=fixture();
  const r=await handler({request:await req({
    action:'confirm',document:doc,explicitlyConfirmed:true,
    token:'x.y'
  }),env:f.env});
  assert.equal(r.status,409);
  assert.equal((await r.json()).code,'cost_preview_expired_or_changed');
  assert.equal(f.writes.length,0);
});
test('preview token ties exact cost, date, owner, expiry and account',async()=>{
  const f=fixture();
  const preview=await (await handler({request:await req({
    action:'preview',document:doc,explicitlyConfirmed:true
  }),env:f.env})).json();
  const other={...doc,cost_kopecks:420001};
  const tampered=await handler({request:await req({
    action:'confirm',document:other,explicitlyConfirmed:true,token:preview.token
  }),env:f.env});
  assert.equal(tampered.status,409);
  const later=createWbCostEntryHandler({now:()=>NOW+600001});
  const expired=await later({request:await req({
    action:'confirm',document:doc,explicitlyConfirmed:true,token:preview.token
  }),env:f.env});
  assert.equal(expired.status,409);
  assert.equal(f.writes.length,0);
});
test('cost cannot be assigned to an arbitrary article or duplicated date',async()=>{
  for(const option of [{vendorExists:false},{costExists:true}]){
    const f=fixture(option);
    const r=await handler({request:await req({
      action:'preview',document:doc,explicitlyConfirmed:true
    }),env:f.env});
    assert.equal(r.status,409);
    assert.equal(f.writes.length,0);
  }
  const f=fixture();
  const r=await handler({request:await req({
    action:'preview',document:{...doc,cost_kopecks:0},
    explicitlyConfirmed:true
  }),env:f.env});
  assert.equal(r.status,400);
});
test('status confirmed requires explicit attestation; preliminary remains separate',async()=>{
  const f=fixture();
  const denied=await handler({request:await req({
    action:'preview',document:doc,explicitlyConfirmed:false
  }),env:f.env});
  assert.equal(denied.status,400);
  const allowed=await handler({request:await req({
    action:'preview',document:{...doc,status:'preliminary'},
    explicitlyConfirmed:false
  }),env:f.env});
  assert.equal(allowed.status,200);
});
