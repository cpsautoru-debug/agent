import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../functions/api/auth/session.js';
import {createOrderStockMatch} from '../functions/api/ms/orders-stock-match.js';
import {manualItemReason} from '../web/office/manual-item-policy.mjs';
import {compactOrders} from '../web/office/office-orders.mjs';
const origin='https://autosklad63-office-staging.pages.dev';
const id='12345678-1234-4234-9234-1234567890ab';
const entry={source:'ozon',sellerAccount:'171189',sku:'synthetic brown with armrest'};
const secret='synthetic-session-key';
const env={OFFICE_SESSION_SECRET:secret,OFFICE_ALLOWED_EMAIL:'owner@synthetic.example',MS_API_TOKEN:'synthetic-only',OZON_FINANCE_DB:{prepare(sql){assert.ok(sql.includes('office_authorized_users'));return {bind:()=>({first:async()=>({allowed:1})})}}}};
async function request(body,authenticated=true){return new Request(origin+'/api/ms/orders-stock-match',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(authenticated?{Cookie:(await createSession('synthetic-owner',secret)).split(';')[0]}:{})},body:JSON.stringify(body)})}
test('live search is bounded, GET-only, explicit and never an approved match',async()=>{
 const calls=[];const handler=createOrderStockMatch({fetcher:async(url,opts)=>{calls.push(url);const u=new URL(url);assert.equal(u.origin,'https://api.moysklad.ru');assert.equal(u.pathname,'/api/remap/1.2/entity/assortment');assert.equal(u.searchParams.get('search'),'synthetic brown');assert.equal(opts.method,'GET');return Response.json({meta:{size:1},rows:[{id,name:'SYNTHETIC brown with armrest',code:'SYNTHETIC-1',archived:false,meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/product/'+id}}]})}});
 const r=await handler({request:await request({entries:[entry],nameQuery:'synthetic brown'}),env});assert.equal(r.status,200);const data=await r.json();assert.equal(data.changedRecords,0);assert.equal(calls.length,1);assert.equal(data.matches[0].possibleNameCandidates[0].id,id);assert.equal(data.matches[0].possibleNameCandidates[0].code,'SYNTHETIC-1');assert.equal(data.matches[0].mappingApproved,false);assert.equal(data.matches[0].accountingTotal,null);
});
test('live search rejects untrusted callers and multi-item search before network',async()=>{
 let calls=0;const handler=createOrderStockMatch({fetcher:async()=>{calls++;throw Error('must not read')}});
 assert.equal((await handler({request:await request({entries:[entry],nameQuery:'synthetic'},false),env})).status,401);
 assert.equal((await handler({request:await request({entries:[entry,{...entry,sku:'other'}],nameQuery:'synthetic'}),env})).status,400);assert.equal(calls,0);
});
test('WB exception is exact, retained in compact list and never a sewing demand',()=>{
 assert.equal(manualItemReason('wb','Пламя1'),'wb_plamya1_manual');assert.equal(manualItemReason('ozon','Пламя1'),null);assert.equal(manualItemReason('wb','Пламя12'),null);
 const o={source:'wb',order_key:'SYNTHETIC',queue_bucket:'active',items:[{sku:'Пламя1',quantity:1}]};const [view]=compactOrders({orders:[o],fulfillment:[{orderKey:'SYNTHETIC',lines:[{status:'sewing_required',missing:1}]}]});assert.equal(view.need,false);assert.equal(view.status,'Ручная обработка');assert.equal(view.order,o);
});
import {buildReview} from '../functions/api/orders/fulfillment-review.mjs';
import {createSkuLinkHandler} from '../functions/api/ms/order-sku-links.js';
test('WB manual exception cannot be mapped or converted to a numeric allocation',async()=>{
 let calls=0;const h=createSkuLinkHandler({fetcher:async()=>{calls++;throw Error('no upstream')}});const r=await h({request:new Request(origin+'/api/ms/order-sku-links',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:(await createSession('synthetic-owner',secret)).split(';')[0]},body:JSON.stringify({source:'wb',sellerAccount:'synthetic-wb',sku:'Пламя1',itemId:id,itemType:'product'})}),env});assert.equal(r.status,409);assert.equal((await r.json()).code,'manual_processing_required');assert.equal(calls,0);
 const row={key:'SYNTHETIC:1',item:'Пламя1',itemId:id,ordered:1,manualReason:'wb_plamya1_manual'};const review=buildReview({status:'warehouse_verified'},[row],{status:'calculated',lines:[{...row,warehouseCovered:0,plannedCovered:0,missing:1}]});assert.equal(review.lines[0].reason,'wb_plamya1_manual');assert.equal(review.lines[0].missing,null);
});
import {DatabaseSync} from 'node:sqlite';
import {ORDER_QUEUE_READ_SQL} from '../functions/api/orders/persistent-queue.js';
test('current order candidates survive more than 150 newer historical WB rows',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE office_order_queue(order_key TEXT,source TEXT,account TEXT,external_id TEXT,source_status TEXT,production_disposition TEXT,items_json TEXT,ms_customerorder_id TEXT,workflow_status TEXT,source_checked_at TEXT,last_seen_at TEXT)');
 const insert=db.prepare('INSERT INTO office_order_queue VALUES (?,?,?,?,?,?,?,?,?,?,?)');for(let i=0;i<160;i++)insert.run('synthetic-history-'+i,'wb','synthetic','h'+i,'delivered','not_for_sewing','[]',null,null,'2026-11-27','2026-11-27');
 for(const [key,source,account,status] of [['synthetic-ozon','ozon','171189','awaiting_deliver'],['synthetic-yandex','yandex','149082506','PROCESSING']])insert.run(key,source,account,key,status,'unverified','[]',null,null,'2026-11-26','2026-11-26');
 const rows=db.prepare(ORDER_QUEUE_READ_SQL).all();assert.equal(rows.length,150);assert.ok(rows.slice(0,2).some(x=>x.order_key==='synthetic-ozon'));assert.ok(rows.slice(0,2).some(x=>x.order_key==='synthetic-yandex'));db.close();
});
