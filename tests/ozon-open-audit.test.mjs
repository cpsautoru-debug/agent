import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzonOpenAudit} from '../functions/api/orders/ozon-open-audit.js';
const now=Date.parse('2026-11-27T12:00:00Z');
const url='https://autosklad63-office-staging.pages.dev/api/orders/ozon-open-audit';
function fixture({owner=1,age=0,rows=[{posting_number:'a',status:'awaiting_deliver'}],count=1}={}){
 let calls=0;
 const env={OFFICE_SESSION_SECRET:'test',OFFICE_ALLOWED_EMAIL:'owner@example.com',OZON_CLIENT_ID:'171189',OZON_API_KEY:'test',OZON_FINANCE_DB:{prepare(sql){
 assert.match(sql,/^SELECT /);
 return {bind(){return this},async first(){return sql.includes('authorized_users')?{allowed:owner}:{last_success_at:new Date(now-age).toISOString(),coverage:'FBS_PACKAGING_AND_AWAITING_DELIVER_LAST_30_DAYS_COMPLETE',rows_seen:count}},async all(){return {results:rows}}};
 }}};
 const handler=createOzonOpenAudit({verify:async()=> 'owner',now:()=>now,audit:async args=>{calls++;assert.deepEqual(args.baseline,rows);return {allOpenVerified:true,pages:1,received:2,onlyUnfulfilled:1,onlyBaseline:0,statusMismatch:0}}});
 return {env,handler,calls:()=>calls};
}
test('owner gets bounded aggregate evidence, never certification',async()=>{
 const f=fixture();const r=await f.handler({request:new Request(url),env:f.env});assert.equal(r.status,200);const d=await r.json();assert.equal(d.allOpenVerified,false);assert.equal(d.onlyUnfulfilled,1);assert.equal(f.calls(),1);assert.equal(JSON.stringify(d).includes('posting_number'),false);
});
test('non-owner, stale or partial baseline, and POST cannot invoke audit',async()=>{
 for(const [options,status,method] of [[{owner:0},403,'GET'],[{age:1800001},409,'GET'],[{count:2},409,'GET'],[{},405,'POST']]){
 const f=fixture(options);const r=await f.handler({request:new Request(url,{method}),env:f.env});assert.equal(r.status,status);assert.equal(f.calls(),0);
 }
});
