import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createWbFinanceMonitorHandler}=await import('../../functions/api/wb/auto-sync-status.js');
const {createSession}=await import('../../functions/api/auth/session.js');
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const ACCOUNT='4271851';
const NOW=Date.UTC(2026,10,21,5,26);
const runtime={
  last_status:'report_complete',last_request_ms:NOW-60_000,
  last_list_day:'2026-11-21',list_offset:0,updated_at:'2026-11-21 05:25:06'
};
const rows=Array.from({length:16},(_,i)=>({
  report_id:String(880000000+i),
  date_from:'2026-10-01',date_to:'2026-10-07',report_type:1,
  bank_payment_kop:10000+i,status:i<9?'complete':'pending',
  row_count:i<9?112:0,sales_count:i<9?80:0,
  returns_count:i<9?2:0,
  api_calculated_payment_kop:i<9?10000+i:null,
  error_code:'',updated_at:'2026-11-21 05:25:06'
}));
function fixture({allow=true,stored=1008,records=rows,state=runtime}={}){
  const queries=[];
  const owner={prepare(sql){
    queries.push(sql);
    assert.match(sql,/^SELECT 1 AS allowed FROM office_authorized_users/);
    return {bind(sub,email){
      assert.equal(email,'owner@example.invalid');
      return {async first(){return allow&&sub==='owner'?{allowed:1}:null;}};
    }};
  }};
  const wb={prepare(sql){
    queries.push(sql);
    assert.match(sql,/^SELECT/);
    assert.doesNotMatch(sql,/INSERT|UPDATE\s+wb_|DELETE|DROP|ALTER/i);
    if(sql.includes('wb_finance_api_runtime'))return {
      bind(account){assert.equal(account,ACCOUNT);
        return {async first(){return state;}};}
    };
    if(sql.includes('wb_finance_api_reports'))return {
      bind(account){assert.equal(account,ACCOUNT);
        return {async all(){return {results:records};}};}
    };
    if(sql.includes('wb_finance_api_rows'))return {
      bind(account){assert.equal(account,ACCOUNT);
        return {async first(){return {count:stored};}};}
    };
    throw Error('unexpected_query');
  }};
  return {queries,env:{
    OFFICE_SESSION_SECRET:'synthetic-private-test-secret',
    OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:owner,
    WB_REPORT_SNAPSHOT_DB:wb,
    WB_REPORT_ACCOUNT_ID:ACCOUNT,
    WB_API_TOKEN:'must-not-be-used-or-returned'
  }};
}
async function req(sub='owner',method='GET'){
  const headers={Accept:'application/json'};
  if(sub)headers.Cookie=(await createSession(sub,
    'synthetic-private-test-secret')).split(';')[0];
  return new Request(ORIGIN+'/api/wb/auto-sync-status',{method,headers});
}
const handler=createWbFinanceMonitorHandler({now:()=>NOW});
test('owner can see actual WB API D1 counts, queue, amounts and last successful request',async()=>{
  const f=fixture();
  const resp=await handler({request:await req(),env:f.env});
  assert.equal(resp.status,200);
  assert.equal(resp.headers.get('Cache-Control'),'private, no-store');
  assert.equal(resp.headers.get('Access-Control-Allow-Origin'),null);
  const result=await resp.json();
  assert.equal(result.reportCount,16);
  assert.equal(result.completedCount,9);
  assert.equal(result.queuedCount,7);
  assert.equal(result.operationsStored,1008);
  assert.equal(result.monitorHealth,'on_schedule');
  assert.equal(result.lastRequestMs,NOW-60_000);
  assert.equal(result.lastJobStatus,'report_complete');
  assert.equal(result.statusCounts.pending,7);
  assert.equal(result.totalBankPaymentKop,
    rows.slice(0,9).reduce((n,r)=>n+r.bank_payment_kop,0));
  assert.equal(result.readOnly,true);
  assert.equal(result.changedRecords,0);
  assert.equal(f.queries.length,4); // Owner auth and exactly 3 D1 SELECTs
  const output=JSON.stringify(result);
  assert.doesNotMatch(output,/must-not-be-used-or-returned|office_session|source_hash/);
  assert.ok(f.queries.slice(1).every(q=>q.startsWith('SELECT')));
});
test('anonymous, unknown Google sub and non-GET requests never read finance tables',async()=>{
  for(const [sub,expected] of [[null,401],['not-owner',403]]){
    const f=fixture();
    const r=await handler({request:await req(sub),env:f.env});
    assert.equal(r.status,expected);
    assert.ok(f.queries.length<=1);
  }
  const f=fixture();
  const r=await handler({request:await req('owner','POST'),env:f.env});
  assert.equal(r.status,405);
  assert.equal(f.queries.length,0);
});
test('if WB D1 is unbound or a row is corrupted status fails closed',async()=>{
  const f=fixture();
  assert.equal((await handler({request:await req(),
    env:{...f.env,WB_REPORT_SNAPSHOT_DB:null}})).status,503);
  const broken=fixture({records:[{...rows[0],report_id:'bad'}]});
  const response=await handler({request:await req(),env:broken.env});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:'wb_api_sync_status_unavailable'});
});
test('more than 300 reports must not be presented as a complete count',async()=>{
  const many=Array.from({length:301},(_,i)=>({
    ...rows[0],report_id:String(i+1)
  }));
  const f=fixture({records:many,stored:99999});
  const r=await handler({request:await req(),env:f.env});
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{code:'wb_api_sync_monitor_incomplete'});
});
test('initial WB database has informative empty state, not a fabricated success',async()=>{
  const f=fixture({state:null,records:[],stored:0});
  const result=await handler({request:await req(),env:f.env});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.reportCount,0);
  assert.equal(body.completedCount,0);
  assert.equal(body.lastRequestMs,null);
  assert.equal(body.warnings[0],'SYNC_DELAYED');
});
test('report reconciliation conflict is displayed but never changes rows',async()=>{
  const f=fixture({records:[{...rows[0],status:'mismatch',
    error_code:'payout_needs_review',api_calculated_payment_kop:8000,
    row_count:0}],stored:0});
  const r=await handler({request:await req(),env:f.env});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.deepEqual(data.warnings,['PAYOUT_MISMATCH']);
  assert.equal(data.mismatchCount,1);
  assert.equal(data.reports[0].errorCode,'payout_needs_review');
  assert.equal(data.reports[0].calculatedPaymentKop,8000);
  assert.equal(data.totalBankPaymentKop,0);
});
