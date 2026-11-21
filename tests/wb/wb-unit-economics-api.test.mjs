import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createWbUnitEconomicsHandler}=await import('../../functions/api/wb/unit-economics.js');
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const secret='test-secret-for-owner-session';
const account='4271851',NOW=Date.UTC(2026,10,21,5,55);
const stats={
  complete_reports:1,pending_reports:1,bank_payout_kop:72000,
  completed_operations:3
};
const rows=[
  {report_id:'101',vendor_code:'VESTA-1',date_from:'2026-10-01',
    date_to:'2026-10-07',status:'complete',operation_count:1,
    sold_units:2,returned_units:0,product_payout_kop:50000,
    platform_fees_kop:2000,additional_payment_kop:0,paid_acceptance_kop:0},
  {report_id:'101',vendor_code:'DOOR-1',date_from:'2026-10-01',
    date_to:'2026-10-07',status:'complete',operation_count:1,
    sold_units:1,returned_units:0,product_payout_kop:30000,
    platform_fees_kop:1000,additional_payment_kop:0,paid_acceptance_kop:0},
  {report_id:'101',vendor_code:null,date_from:'2026-10-01',
    date_to:'2026-10-07',status:'complete',operation_count:1,
    sold_units:0,returned_units:0,product_payout_kop:0,
    platform_fees_kop:5000,additional_payment_kop:0,paid_acceptance_kop:0}
];
const costs=[
  {vendor_code:'VESTA-1',valid_from:'2026-09-01',valid_to:null,
    cost_kopecks:36000,status:'confirmed',source:'М+швея+раскройщик'},
  {vendor_code:'DOOR-1',valid_from:'2026-10-01',valid_to:null,
    cost_kopecks:12000,status:'confirmed',source:'Техкарта вставки'}
];
function fixture({allowed=true,groups=rows,savedCosts=costs,
  noCostTable=false,summary=stats}={}){
  const queries=[];
  const owner={prepare(sql){
    queries.push(sql);
    if(!sql.startsWith('SELECT 1 AS allowed'))throw Error('unexpected_owner_sql');
    return{bind(sub,email){assert.equal(email,'owner@example.invalid');
      return{async first(){return allowed&&sub==='owner'?{allowed:1}:null;}};
    }};
  }};
  const wb={prepare(sql){
    queries.push(sql);
    assert.match(sql,/^SELECT /);
    assert.doesNotMatch(sql,/^(?:INSERT|UPDATE|DELETE|DROP|ALTER)/);
    if(sql.includes('FROM wb_finance_api_reports WHERE account_id=?')){
      return{bind(id){assert.equal(id,account);
        return{async first(){return summary;}};
      }};
    }
    if(sql.includes('FROM wb_finance_api_rows r')){
      assert.match(sql,/p\.status='complete'/);
      assert.match(sql,/GROUP BY r\.report_id,r\.vendor_code/);
      return{bind(id){assert.equal(id,account);
        return{async all(){return{results:groups};}};
      }};
    }
    if(sql.includes('FROM sqlite_master')){
      assert.match(sql,/name='wb_profit_unit_costs'/);
      return {async first(){
        return noCostTable?null:{name:'wb_profit_unit_costs'};
      }};
    }
    if(sql.includes('FROM wb_profit_unit_costs')){
      return{bind(id){assert.equal(id,account);
        return{async all(){return{results:savedCosts};}};
      }};
    }
    throw Error('unexpected_wb_sql: '+sql);
  }};
  return{queries,env:{
    OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:owner,WB_REPORT_SNAPSHOT_DB:wb,
    WB_REPORT_ACCOUNT_ID:account
  }};
}
async function request(sub='owner',method='GET',suffix=''){
  const headers={Accept:'application/json'};
  if(sub)headers.Cookie=(await createSession(sub,secret)).split(';')[0];
  return new Request(ORIGIN+'/api/wb/unit-economics'+suffix,{method,headers});
}
const handler=createWbUnitEconomicsHandler({now:()=>NOW});
test('owner sees reconciled article preview and explicitly non-final net profit',async()=>{
  const f=fixture();
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  const body=await response.json();
  assert.equal(body.code,'wb_unit_economics_preview');
  assert.equal(body.reportCount,undefined);
  assert.equal(body.skuCount,2);
  assert.equal(body.completeReports,1);
  assert.equal(body.pendingReports,1);
  assert.equal(body.reconciliation,'matched');
  assert.equal(body.netProfitKopecks,null);
  assert.equal(body.costRegistry,'ready');
  assert.equal(body.articles.find(x=>x.vendorCode==='VESTA-1')
    .contributionAfterKnownCogsKopecks,-24000);
  assert.equal(body.totalKnownManufacturingCogsKopecks,84000);
  assert.equal(f.queries.length,5);
  assert.ok(f.queries.every(q=>q.startsWith('SELECT ')));
  assert.doesNotMatch(JSON.stringify(body),/test-secret|rrd_id|source_hash/);
});
test('missing new cost migration still shows articles but blocks profit',async()=>{
  const f=fixture({noCostTable:true});
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.costRegistry,'migration_required');
  assert.equal(data.missingCostSoldUnits,3);
  assert.equal(data.netProfitKopecks,null);
  assert.equal(data.articles[0].contributionAfterKnownCogsKopecks,null);
});
test('anonymous, wrong owner and POST never access finance tables',async()=>{
  for(const [sub,status] of [[null,401],['wrong',403]]){
    const f=fixture();
    const r=await handler({request:await request(sub),env:f.env});
    assert.equal(r.status,status);
    assert.ok(f.queries.length<=1);
  }
  const f=fixture();
  const response=await handler({request:await request('owner','POST'),env:f.env});
  assert.equal(response.status,405);
  assert.equal(f.queries.length,0);
});
test('unreconciled payment fails closed instead of showing false SKU profit',async()=>{
  const f=fixture({summary:{...stats,bank_payout_kop:72001}});
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:'wb_profit_payout_reconciliation_failed'});
});
test('oversized aggregation returns explicit incomplete and no fake zero',async()=>{
  const many=Array.from({length:1201},(_,i)=>({...rows[0],
    vendor_code:'SKU-'+i}));
  const f=fixture({groups:many});
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:'wb_profit_coverage_unavailable'});
});
test('failure to access shared finance DB does not return sensitive details',async()=>{
  const f=fixture();
  delete f.env.WB_REPORT_SNAPSHOT_DB;
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:'configuration_unavailable'});
});
test('missing cost table is detected by read-only schema query, not parsed D1 errors',async()=>{
  const f=fixture({noCostTable:true});
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.costRegistry,'migration_required');
  assert.equal(f.queries.length,4); // owner + two report reads + sqlite_master
  assert.ok(!f.queries.some(x=>x.includes('FROM wb_profit_unit_costs')));
});
test('unavailable database read identifies stage but does not leak backend error',async()=>{
  const f=fixture();
  f.env.WB_REPORT_SNAPSHOT_DB.prepare=()=>{throw Error('sensitive_private_db_error');};
  const response=await handler({request:await request(),env:f.env});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{
    code:'wb_profitability_unavailable',stage:'completed_report_aggregation'
  });
});
