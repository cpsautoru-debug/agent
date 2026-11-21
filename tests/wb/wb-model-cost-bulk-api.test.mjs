import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createWbModelCostBatchHandler}=await import(
  '../../functions/api/wb/model-cost-batch.js'
);
const ORIGIN='https://autosklad63-office-staging.pages.dev',
  secret='test-session-key',account='4271851';
const NOW=Date.UTC(2026,10,21,6,35);
const model={
  familyId:'vesta',vendorCodes:['Веста коричневая','Vesta 3 black'],
  costKopecks:420000,validFrom:'2026-10-01',status:'confirmed',
  source:'Техкарта Vesta 2026 проверена',
  sameTechCardConfirmed:true,includesMaterialsSeamstressCutterOnly:true,
  explicitlyConfirmed:true
};
function fixture({owner=true,exists=true,hasCost=false,failBatch=false}={}){
  const info={queries:[],writes:[],alreadySaved:hasCost};
  const ozon={prepare(sql){
    info.queries.push(sql);
    assert.match(sql,/^SELECT 1 AS allowed/);
    return{bind(sub,email){
      assert.equal(email,'owner@example.invalid');
      return{async first(){return owner&&sub==='owner'?{allowed:1}:null;}};
    }};
  }};
  const wb={prepare(sql){
    info.queries.push(sql);
    if(sql.includes('SELECT DISTINCT r.vendor_code')){
      assert.match(sql,/p.status='complete'/);
      return{bind(id,...codes){
        assert.equal(id,account);assert.equal(codes.length,2);
        return{async all(){
          return{results:exists?codes.map(vendor_code=>({vendor_code})):[]};
        }};
      }};
    }
    if(sql.includes('SELECT vendor_code FROM wb_profit_unit_costs')){
      return{bind(id,...codes){
        assert.equal(id,account);assert.equal(codes.length,2);
        return{async first(){
          return info.alreadySaved?{vendor_code:codes[0]}:null;
        }};
      }};
    }
    if(sql.startsWith('INSERT INTO wb_profit_unit_costs')){
      return{bind(...args){
        assert.equal(args[0],account);
        assert.equal(args[2],'2026-10-01');
        assert.equal(args[4],'confirmed');
        assert.match(args[5],/Группа vesta; Техкарта/);
        return {sql,args};
      }};
    }
    throw Error('Unexpected SQL '+sql);
  },async batch(statements){
    if(failBatch)throw Error('D1 batch refused');
    info.writes.push(...statements);
    info.alreadySaved=true;
    return statements.map(()=>({success:true,meta:{changes:1}}));
  }};
  return{info,env:{
    OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:ozon,WB_REPORT_SNAPSHOT_DB:wb,
    WB_REPORT_ACCOUNT_ID:account
  }};
}
async function request(body,sub='owner',origin=ORIGIN){
  const headers={Origin:origin,'Content-Type':'application/json'};
  if(sub)headers.Cookie=(await createSession(sub,secret)).split(';')[0];
  return new Request(ORIGIN+'/api/wb/model-cost-batch',{
    method:'POST',headers,body:JSON.stringify(body)
  });
}
const handler=createWbModelCostBatchHandler({now:()=>NOW});
test('owner-only preview is read-only; signed confirmation writes an atomic model batch',async()=>{
  const f=fixture();
  const previewResponse=await handler({request:await request({
    action:'preview',document:model
  }),env:f.env});
  assert.equal(previewResponse.status,200);
  const preview=await previewResponse.json();
  assert.equal(preview.code,'wb_model_cost_batch_preview');
  assert.equal(preview.count,2);
  assert.equal(preview.changedRecords,0);
  assert.equal(typeof preview.token,'string');
  assert.equal(f.info.writes.length,0);
  const savedResponse=await handler({request:await request({
    action:'confirm',document:model,token:preview.token
  }),env:f.env});
  assert.equal(savedResponse.status,200);
  assert.deepEqual(await savedResponse.json(),{
    code:'wb_model_cost_batch_saved',changedRecords:2,
    familyId:'vesta',costKopecks:420000,
    validFrom:'2026-10-01',status:'confirmed'
  });
  assert.equal(f.info.writes.length,2);
  assert.ok(f.info.writes.every(s=>s.sql.startsWith('INSERT INTO wb_profit_unit_costs')));
  assert.ok(f.info.writes.every(s=>s.args[6]==='owner'));
  const replay=await handler({request:await request({
    action:'confirm',document:model,token:preview.token
  }),env:f.env});
  assert.equal(replay.status,409);
  assert.equal((await replay.json()).code,
    'existing_cost_version_requires_individual_review');
  assert.equal(f.info.writes.length,2);
});
test('no writes for anonymous, nonowner, foreign origin or false group attestations',async()=>{
  for(const options of [
    {sub:null,origin:ORIGIN,status:401},
    {sub:'not-owner',origin:ORIGIN,status:403},
    {sub:'owner',origin:'https://evil.example',status:403}
  ]){
    const f=fixture();
    const r=await handler({request:await request({
      action:'confirm',document:model,token:'none'
    },options.sub,options.origin),env:f.env});
    assert.equal(r.status,options.status);
    assert.equal(f.info.writes.length,0);
  }
  const f=fixture();
  const r=await handler({request:await request({
    action:'preview',document:{...model,
      includesMaterialsSeamstressCutterOnly:false}
  }),env:f.env});
  assert.equal(r.status,400);
  assert.equal(f.info.writes.length,0);
});
test('fake SKUs, existing price and invalid signature are rejected without writes',async()=>{
  for(const config of [{exists:false},{hasCost:true}]){
    const f=fixture(config);
    const res=await handler({request:await request({
      action:'preview',document:model
    }),env:f.env});
    assert.equal(res.status,409);
    assert.equal(f.info.writes.length,0);
  }
  const f=fixture();
  const res=await handler({request:await request({
    action:'confirm',document:model,token:'incorrect'
  }),env:f.env});
  assert.equal(res.status,409);
  assert.equal(f.info.writes.length,0);
});
test('token is bound to price and date and expires after ten minutes',async()=>{
  const f=fixture();
  const first=await handler({request:await request({
    action:'preview',document:model
  }),env:f.env});
  const preview=await first.json();
  const mismatch=await handler({request:await request({
    action:'confirm',document:{...model,costKopecks:420001},
    token:preview.token
  }),env:f.env});
  assert.equal(mismatch.status,409);
  const later=createWbModelCostBatchHandler({now:()=>NOW+600001});
  const expired=await later({request:await request({
    action:'confirm',document:model,token:preview.token
  }),env:f.env});
  assert.equal(expired.status,409);
  assert.equal(f.info.writes.length,0);
});
test('database rejects batch without claiming successful partial profit',async()=>{
  const f=fixture({failBatch:true});
  const preview=await (await handler({request:await request({
    action:'preview',document:model
  }),env:f.env})).json();
  const response=await handler({request:await request({
    action:'confirm',document:model,token:preview.token
  }),env:f.env});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:'wb_model_cost_batch_unavailable'});
  assert.equal(f.info.writes.length,0);
});
