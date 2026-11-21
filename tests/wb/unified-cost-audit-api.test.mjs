import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
  if(url.includes('/functions/api/')&&url.endsWith('.js'))
    return {...next(url,{...context,format:'module'}),format:'module'};
  return next(url,context);
}});
const {createSession}=await import('../../functions/api/auth/session.js');
const {createUnifiedCostAuditHandler}=await import('../../functions/api/finance/cost-audit.js');
const ORIGIN='https://autosklad63-office-staging.pages.dev',secret='owner-test-secret';
const TARGET='ce9dd331-929d-4c3e-9073-368de3346bc9';
const costRow={
  vendor_code:'веста №2',valid_from:'2026-08-30',valid_to:null,
  cost_kopecks:420000,status:'preliminary',source:'Внутренний расчёт Vesta'
};
const catalogRow={
  sku:'OZ-1',seller_article:'веста №2',model:'Lada Vesta',
  cost_kopecks:420000,status:'confirmed',source:'Подтверждено'
};
function fixture({owner=true,costTable=true,rpcAvailable=true,
  badCatalog=false}={}){
  const calls=[],rpcCalls=[];
  const authDB={prepare(sql){
    calls.push(sql);
    if(sql.includes('office_authorized_users'))
      return {bind(){return{async first(){return owner?{allowed:1}:null;}};}};
    if(sql.includes('FROM ozon_cost_entries'))
      return {async all(){return{results:badCatalog?
        [{...catalogRow,cost_kopecks:'bad'}]:[catalogRow]};}};
    throw Error('unexpected Ozon SQL');
  }};
  const wbDB={prepare(sql){
    calls.push(sql);
    if(sql.includes('FROM sqlite_master'))
      return {async first(){return costTable?{name:'wb_profit_unit_costs'}:null;}};
    if(sql.includes('FROM wb_profit_unit_costs'))
      return {bind(id){
        assert.equal(id,'4271851');
        return{async all(){return{results:[costRow]};}};
      }};
    throw Error('unexpected WB SQL');
  }};
  const rpc={async getProfitDocument(key){
    rpcCalls.push(key);
    if(!rpcAvailable)throw Error('worker offline sensitive cause');
    if(key==='costs')return{key,target:TARGET,version:1,value:{
      entries:[{sku:'OZ-1',validFrom:'2026-08-01',validTo:null,
        costKopecks:420000,status:'confirmed',source:'Profit verified',
        leatherDeliveryIncluded:null}]
    }};
    return{key,target:TARGET,version:2,value:{
      items:[{id:'rent',label:'Аренда',amountKopecks:5000000,
        validFrom:'2026-11-01',validTo:null,scope:'business',leatherDelivery:false}],
      allocation:{method:'unallocated',shares:null,revenue:null,source:''}
    }};
  }};
  return {calls,rpcCalls,env:{
    OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@example.invalid',
    OZON_FINANCE_DB:authDB,WB_REPORT_SNAPSHOT_DB:wbDB,
    WB_REPORT_ACCOUNT_ID:'4271851',OZON_FINANCE_SYNC:rpc
  }};
}
async function request({actor='owner',method='GET',path='/api/finance/cost-audit'}={}){
  const headers={Accept:'application/json'};
  if(actor)headers.Cookie=(await createSession(actor,secret)).split(';')[0];
  return new Request(ORIGIN+path,{method,headers});
}
const handler=createUnifiedCostAuditHandler({now:()=>Date.UTC(2026,10,21,12)});
test('owner sees both real cost sources and Profit/expense versions without writes',async()=>{
  const f=fixture();
  const res=await handler({request:await request(),env:f.env});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('Cache-Control'),'private, no-store');
  const body=await res.json();
  assert.equal(body.code,'unified_finance_source_audit');
  assert.equal(body.readOnly,true);
  assert.equal(body.month,'2026-11');
  assert.equal(body.wb.entries.length,1);
  assert.equal(body.wb.entries[0].status,'preliminary');
  assert.equal(body.ozonCatalog.entries.length,1);
  assert.equal(body.ozonProfit.version,1);
  assert.equal(body.ozonProfit.entries.length,1);
  assert.equal(body.expenses.version,2);
  assert.equal(body.expenses.businessItems,1);
  assert.equal(body.canonicalSharedCatalogReady,false);
  assert.equal(body.netProfitKopecks,null);
  assert.deepEqual(f.rpcCalls,['costs','expenses']);
  assert.ok(f.calls.every(x=>x.startsWith('SELECT ')));
  assert.doesNotMatch(JSON.stringify(body),/owner@example.invalid|owner-test-secret/);
});
test('no owner means no ledger reads or RPC requests',async()=>{
  for(const [actor,owner,status] of [
    [null,true,401],['outsider',false,403]
  ]){
    const f=fixture({owner});
    const res=await handler({request:await request({actor}),env:f.env});
    assert.equal(res.status,status);
    assert.equal(f.rpcCalls.length,0);
    assert.equal(f.calls.filter(x=>x.includes('FROM ozon_cost_entries')).length,0);
  }
  const f=fixture();
  const res=await handler({request:await request({method:'POST'}),env:f.env});
  assert.equal(res.status,405);
  assert.equal(f.calls.length,0);
});
test('Ozon Profit RPC unavailable is not treated as empty confirmed sources',async()=>{
  const f=fixture({rpcAvailable:false});
  const res=await handler({request:await request(),env:f.env});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.wb.count,1);
  assert.equal(data.ozonProfit.status,'unavailable');
  assert.equal(data.expenses.status,'unavailable');
  assert.ok(data.blockers.includes('ozon_profit_source_unavailable'));
  assert.equal(data.netProfitKopecks,null);
});
test('missing WB cost migration is described rather than inventing cost zero',async()=>{
  const f=fixture({costTable:false});
  const res=await handler({request:await request(),env:f.env});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.wb.status,'migration_required');
  assert.ok(data.blockers.includes('wb_cost_migration_required'));
});
test('invalid catalog fails closed, no private exception leakage',async()=>{
  const f=fixture({badCatalog:true});
  const res=await handler({request:await request(),env:f.env});
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{
    code:'unified_cost_audit_unavailable',stage:'source_validation'
  });
});
test('invalid query scope is rejected before reading cost ledgers',async()=>{
  const f=fixture();
  const r=await handler({request:await request({
    path:'/api/finance/cost-audit?debug=1'
  }),env:f.env});
  assert.equal(r.status,400);
  assert.equal(f.calls.length,0);
});
