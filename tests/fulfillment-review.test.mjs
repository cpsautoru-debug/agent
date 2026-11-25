import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {buildReview,readReviews,saveReview} from '../functions/api/orders/fulfillment-review.mjs';

test('saves current review once and invalidates changed, cancelled and absent orders',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['persistent_order_queue','order_warehouse','order_fulfillment']){
  const sql=readFileSync(new URL('../migrations/20261125_'+name+'.sql',import.meta.url),'utf8');
  sqlite.exec(sql);
  sqlite.exec(sql);
 }
 const db={prepare:sql=>({bind:(...values)=>({
  run:()=>({meta:sqlite.prepare(sql).run(...values)}),
  all:()=>({results:sqlite.prepare(sql).all(...values)})
 })})};
 const source=new Date().toISOString();
 const check=new Date(Date.now()+1).toISOString();
 const repeated=new Date(Date.now()+2).toISOString();
 const order={order_key:'key',source_checked_at:source};
 sqlite.prepare("INSERT INTO office_order_queue(order_key,source,account,external_id,source_status,production_disposition,items_json,source_checked_at) VALUES('key','ozon','account','id','awaiting_packaging','unverified','[]',?)").run(source);
 sqlite.prepare("INSERT INTO office_order_queue_sync(source,last_success_at,coverage,rows_seen,note) VALUES('ozon',?,'test',1,'fixture')").run(source);
 const review=buildReview({status:'warehouse_unverified'},[{item:'SKU',itemId:null,ordered:5}]);
 assert.equal(review.lines[0].missing,null);
 assert.equal((await saveReview(db,order,check,review)).meta.changes,1);
 assert.equal((await saveReview(db,order,repeated,review)).meta.changes,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM office_order_fulfillment_history').get().n,1);
 assert.equal((await readReviews(db)).results.length,1);
 sqlite.prepare("UPDATE office_order_queue_sync SET last_success_at=? WHERE source='ozon'").run(repeated);
 assert.equal((await readReviews(db)).results.length,0);
 sqlite.prepare("UPDATE office_order_queue SET items_json='[2]', source_checked_at=? WHERE order_key='key'").run(repeated);
 assert.equal((await readReviews(db)).results.length,0);
 assert.equal((await saveReview(db,order,repeated,review)).meta.changes,0);
 const next={...order,source_checked_at:repeated};
 const changed=buildReview({status:'warehouse_unverified'},[{item:'SKU',itemId:null,ordered:2}]);
 assert.equal((await saveReview(db,next,repeated,changed)).meta.changes,1);
 assert.equal(JSON.parse((await readReviews(db)).results[0].result_json).lines[0].ordered,2);
 const cancelled=new Date(Date.now()+3).toISOString();
 sqlite.prepare("UPDATE office_order_queue SET source_status='cancelled',source_checked_at=? WHERE order_key='key'").run(cancelled);
 sqlite.prepare("UPDATE office_order_queue_sync SET last_success_at=? WHERE source='ozon'").run(cancelled);
 assert.equal((await readReviews(db)).results.length,0);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM office_order_fulfillment_history').get().n,2);
});

test('only complete cohort evidence becomes a numeric sewing requirement',()=>{
 const warehouse={status:'warehouse_verified'};
 const row={key:'order:0',item:'SKU',itemId:'item',ordered:5,
  accounting:{status:'accounting_verified'},
  occupancy:{status:'warehouse_orders_verified'},
  production:{status:'production_verified'}};
 const complete={status:'calculated',lines:[{key:'order:0',itemId:'item',
  warehouseCovered:2,plannedCovered:1,missing:2,productionTaskIds:['job']}]};
 const accepted=buildReview(warehouse,[row],complete).lines[0];
 assert.equal(accepted.status,'sewing_required');
 assert.equal(accepted.missing,2);
 assert.equal(accepted.warehouseCovered,2);
 assert.equal(accepted.plannedCovered,1);
 for(const proof of [null,{status:'requires_review',lines:complete.lines},
  {status:'calculated',lines:[{...complete.lines[0],missing:0}]}]){
  const rejected=buildReview(warehouse,[row],proof).lines[0];
  assert.equal(rejected.status,'requires_review');
  assert.equal(rejected.missing,null);
 }
});

test('manual channels use manual snapshot clock when reading saved reviews',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['persistent_order_queue','order_warehouse','order_fulfillment']){
  sqlite.exec(readFileSync(new URL('../migrations/20261125_'+name+'.sql',import.meta.url),'utf8'));
 }
 const db={prepare:sql=>({bind:(...values)=>({
  run:()=>({meta:sqlite.prepare(sql).run(...values)}),
  all:()=>({results:sqlite.prepare(sql).all(...values)})
 })})};
 const stamp=new Date().toISOString();
 sqlite.prepare("INSERT INTO office_order_queue(order_key,source,account,external_id,source_status,production_disposition,items_json,source_checked_at) VALUES('manual-test','plamya','moysklad','order','Regular','unverified','[]',?)").run(stamp);
 sqlite.prepare("INSERT INTO office_order_queue_sync(source,last_success_at,coverage,rows_seen,note) VALUES('manual',?,'fixture',1,'fixture')").run(stamp);
 const review=buildReview({status:'warehouse_unverified'},[{item:'test',itemId:null,ordered:1}]);
 assert.equal((await saveReview(db,{order_key:'manual-test',source_checked_at:stamp},new Date(Date.now()+1).toISOString(),review)).meta.changes,1);
 assert.equal((await readReviews(db)).results.length,1);
});
