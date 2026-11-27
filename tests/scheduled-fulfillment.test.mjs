import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledFulfillment,NEXT_SQL} from '../functions/api/orders/scheduled-fulfillment.js';
import {signBridgeRequest} from '../workers/ms-production-bridge-auth.js';
import {DatabaseSync} from 'node:sqlite';
const stamp=Date.now(),secret='A'.repeat(43),path='/api/orders/scheduled-fulfillment',origin='https://autosklad63-office-staging.pages.dev';
async function request(signed=true,suffix=''){return new Request(origin+path+suffix,{method:'POST',headers:signed?{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,path)}:{}})}
test('scheduled scan rejects unsigned requests and remains opt-in',async()=>{let calls=0;const h=createScheduledFulfillment({now:()=>stamp});const env={MS_SALES_BRIDGE_SECRET:secret,OZON_FINANCE_DB:{prepare(){calls++;throw Error()}}};assert.equal((await h({request:await request(false),env})).status,401);assert.equal((await h({request:await request(),env})).status,503);assert.equal((await h({request:await request(true,'?orderKey=evil'),env})).status,400);assert.equal(calls,0)});
test('signed scan invokes one internally selected order and no public auth bypass',async()=>{let calls=0;const env={MS_SALES_BRIDGE_SECRET:secret,MS_FULFILLMENT_AUTO_SCAN:'enabled',OZON_FINANCE_DB:{prepare(sql){assert.equal(sql,NEXT_SQL);return {bind:()=>({first:async()=>({order_key:'AS63:yandex:149082506:synthetic'})})}}}};const h=createScheduledFulfillment({now:()=>stamp,makePrecheck:({authorizeServer})=>async({request})=>{calls++;assert.equal(await authorizeServer(request),true);assert.equal(await authorizeServer(request.clone()),false);assert.deepEqual(await request.json(),{orderKey:'AS63:yandex:149082506:synthetic'});return Response.json({code:'order_stock_precheck',changedMoySkladRecords:0,reviewStored:true})}});const r=await h({request:await request(),env});assert.equal(r.status,200);assert.equal((await r.json()).code,'scheduled_fulfillment_checked');assert.equal(calls,1)});

test('new mapped current WB order receives first review before recurring Yandex checkpoint; stale Ozon excluded',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE office_order_queue(order_key TEXT,source TEXT,account TEXT,source_status TEXT,source_checked_at TEXT,items_json TEXT);CREATE TABLE office_order_queue_sync(source TEXT,last_success_at TEXT);CREATE TABLE office_order_warehouse_routes(source TEXT,seller_account TEXT);CREATE TABLE office_order_sku_links(source TEXT,seller_account TEXT,marketplace_sku TEXT);CREATE TABLE office_order_fulfillment(order_key TEXT,source_checked_at TEXT,checked_at TEXT,result_json TEXT);");
 const current='2026-11-27T17:10:00Z',cutoff='2026-11-27T17:00:00Z';
 for(const [key,source,account,status,at,sku] of [['ya','yandex','149082506','PROCESSING',current,'sku'],['wb','wb','wb-primary','wb_confirmed_assembly',current,'sku'],['old','ozon','171189','awaiting_packaging',cutoff,'sku'],['manual','wb','wb-primary','wb_confirmed_assembly',current,'Пламя1']]){
 db.prepare('INSERT INTO office_order_queue VALUES(?,?,?,?,?,?)').run(key,source,account,status,at,JSON.stringify([{sku}]));
 if(key!=='manual'){db.prepare('INSERT INTO office_order_queue_sync VALUES(?,?)').run(source,current);db.prepare('INSERT INTO office_order_warehouse_routes VALUES(?,?)').run(source,account);}
 db.prepare('INSERT INTO office_order_sku_links VALUES(?,?,?)').run(source,account,sku);
 }
 db.prepare('INSERT INTO office_order_fulfillment VALUES(?,?,?,?)').run('ya',current,current,JSON.stringify({lines:[{production:{reason:'checkpoint_pending'}}]}));
 const next=db.prepare(NEXT_SQL);assert.equal(next.get(cutoff,cutoff).order_key,'wb');
 db.prepare('INSERT INTO office_order_fulfillment VALUES(?,?,?,?)').run('wb',current,current,JSON.stringify({lines:[]}));
 assert.equal(next.get(cutoff,cutoff).order_key,'ya');db.close();
});
