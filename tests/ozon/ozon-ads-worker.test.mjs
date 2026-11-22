import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../../workers/ozon-ads-staging.js',import.meta.url),'utf8');
const {readOzonExpense,default:worker}=await import(
  'data:text/javascript;base64,'+Buffer.from(src).toString('base64')
);
const env={OZON_PERFORMANCE_CLIENT_ID:'test-id',
  OZON_PERFORMANCE_CLIENT_SECRET:'test-secret',
  ADS_READ_TOKEN:'x'.repeat(48)};
const request=(path,auth)=>new Request('https://test.example'+path,
  {headers:auth?{authorization:auth}:{}});
const response=(data,status=200)=>new Response(JSON.stringify(data),
  {status,headers:{'content-type':'application/json'}});
test('health shows no secrets or fetched financial data',async()=>{
  const res=await worker.fetch(request('/health'),env);
  assert.equal(res.status,200);
  const value=await res.json();
  assert.equal(value.authConfigured,true);
  assert.equal(value.accessProtected,true);
  assert.equal(JSON.stringify(value).includes('test-secret'),false);
});
test('data endpoint denies public access and missing separate office token',async()=>{
  assert.equal((await worker.fetch(
    request('/api/internal/expense?month=2026-10'),env)).status,401);
  assert.equal((await worker.fetch(
    request('/api/internal/expense?month=2026-10','Bearer wrong'),env)).status,401);
  assert.equal((await worker.fetch(
    request('/api/internal/expense?month=2026-10'),
    {...env,ADS_READ_TOKEN:undefined})).status,503);
});
test('Ozon expense read uses current host, correct month and separate OAuth token',async()=>{
  const calls=[];
  const fetcher=async(url,opts)=>{
    calls.push({url,opts});
    return calls.length===1?response({access_token:'token-secret'}):
      response([{campaignId:'1',date:'2026-10-02',moneySpent:'10.00'}]);
  };
  const out=await readOzonExpense('2026-10',env,fetcher);
  assert.equal(out.status,200);
  assert.equal(out.body.recordCount,1);
  assert.equal(out.body.totalExpenseKopecks,null);
  assert.equal(out.body.monetaryTotalsVerified,false);
  assert.equal(out.body.reconciledToFinance,false);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'https://api-performance.ozon.ru/api/client/token');
  assert.equal(JSON.parse(calls[0].opts.body).grant_type,'client_credentials');
  const url=new URL(calls[1].url);
  assert.equal(url.pathname,'/api/client/statistics/expense/json');
  assert.equal(url.searchParams.get('dateFrom'),'2026-10-01');
  assert.equal(url.searchParams.get('dateTo'),'2026-10-31');
  assert.equal(calls[1].opts.headers.authorization,'Bearer token-secret');
});
test('empty and unrecognized responses never imply zero spend',async()=>{
  const fetcher=async(url)=>url.endsWith('/token')?
    response({access_token:'ok'}):response({unexpected:true});
  const result=await readOzonExpense('2026-10',env,fetcher);
  assert.equal(result.status,422);
  assert.equal(result.body.monetaryTotalsVerified,false);
  const blank=await readOzonExpense('2026-10',env,async url=>
    url.endsWith('/token')?response({access_token:'ok'}):response([]));
  assert.equal(blank.body.totalExpenseKopecks,null);
});
test('bad months rejected without external API traffic',async()=>{
  let calls=0;const fn=async()=>{calls++;throw Error('unexpected')};
  for(const period of ['2026-13','2026-11','2026-10-01','2024-00']){
    const x=await readOzonExpense(period,env,fn);
    assert.equal(x.status,400);
  }
  assert.equal(calls,0);
});
test('auth errors and rate limits have no leaked sensitive data',async()=>{
  const calls=[];
  const result=await readOzonExpense('2026-10',env,async url=>{
    calls.push(url);
    return calls.length===1?response({access_token:'ok'}):
      response({error:'sensitive'},429);
  });
  assert.equal(result.status,503);
  assert.equal(result.body.code,'ozon_performance_rate_limited');
  assert.equal(JSON.stringify(result).includes('sensitive'),false);
});
test('only GET and explicit routes accepted',async()=>{
  assert.equal((await worker.fetch(new Request('https://test.example/health',
    {method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(request('/'),env)).status,404);
});
