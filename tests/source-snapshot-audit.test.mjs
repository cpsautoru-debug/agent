import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSnapshots,createSourceSnapshotAudit} from '../functions/api/orders/source-snapshot-audit.js';
const row=(key,status='new',items=[{sku:'a',quantity:1}])=>({key,sourceStatus:status,items});
test('compare identities statuses and SKU quantities, independent of line order',()=>{
 const a=[row('a'),row('b'),row('c'),row('d','new',[{sku:'a',quantity:1},{sku:'b',quantity:2}])];
 const b=[row('a','sent'),row('b','new',[{sku:'a',quantity:2}]),row('e'),row('d','new',[{sku:'b',quantity:2},{sku:'a',quantity:1}])];
 assert.deepEqual(compareSnapshots(a,b),{baselineCount:4,received:4,onlyLive:1,onlyBaseline:1,statusMismatch:1,itemMismatch:1});
 assert.throws(()=>compareSnapshots([row('a'),row('a')],[]));
 assert.throws(()=>compareSnapshots([row('a','new',[{sku:'a',quantity:0}])],[]));
});
test('owner only, fresh complete bounded baseline, no writes or certification',async()=>{
 const now=Date.parse('2026-11-27T18:00:00Z');
 for(const [owner,count,age,expected] of [[1,1,0,200],[0,1,0,403],[1,2,0,409],[1,1,1800001,409]]){
 let reads=0;
 const env={OFFICE_SESSION_SECRET:'test',OFFICE_ALLOWED_EMAIL:'owner@example.com',OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/^SELECT /);return {bind(){return this},async first(){return sql.includes('authorized_users')?{allowed:owner}:{last_success_at:new Date(now-age).toISOString(),coverage:'WB_NEW_AND_30_DAY_FBS_STATUS_SNAPSHOT',rows_seen:count}},async all(){return {results:[{order_key:'a',source_status:'new',items_json:'[{"sku":"a","quantity":1}]'}]}}};}}};
 const handler=createSourceSnapshotAudit({verify:async()=> 'owner',now:()=>now,read:async()=>{reads++;return [row('a')]}});
 const r=await handler({request:new Request('https://autosklad63-office-staging.pages.dev/api/orders/source-snapshot-audit?source=wb'),env});
 assert.equal(r.status,expected);assert.equal(reads,expected===200?1:0);const data=await r.json();assert.equal(data.allOpenVerified,false);assert.equal(data.readOnly,true);
 if(expected===200)assert.equal(data.itemMismatch,0);
 }
});
