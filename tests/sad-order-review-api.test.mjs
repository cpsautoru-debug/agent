import test from 'node:test';
import assert from 'node:assert/strict';
import {createSadOrderReviewHandler} from '../functions/api/yandex/sad-order-review.js';
const month='2026-10',now=()=>Date.parse('2026-11-28T00:00:00Z');
const rows=[{month,scope:'all',report_type:'orders',report_id:'orders-id',status:'DONE'},{month,scope:'149082506',report_type:'realization',report_id:'sad-id',status:'DONE'}];
const response=(sheets)=>Response.json({code:'yandex_report_archive_audited',readOnly:true,changedRecords:0,sheets});
const orderSheet={sheet:'services_and_orders_margin.json',rows:1,duplicateOrderIds:0,ordersWithIds:1,marginOrderLedger:[{orderId:'1',incomeKopecks:500}]};
const deliverySheet={sheet:'delivered.json',rows:1,deliveryOrderLedger:[{orderId:'1',shopSku:'A',units:1}]};
function fixture({initial=rows,latest=initial,auth=null,fail=null}={}){
 let reads=0,calls=[];
 const env={OZON_FINANCE_DB:{prepare(sql){assert.match(sql,/scope='149082506'/);return{bind(m){assert.equal(m,month);return{async all(){return{results:reads++?latest:initial};}}}}}}};
 const handler=createSadOrderReviewHandler({now,authorize:async()=>auth,audit:async({request})=>{const id=new URL(request.url).searchParams.get('reportId');calls.push(id);assert.equal(request.headers.get('Cookie'),'session=test');return id===fail?Response.json({}, {status:503}):response([id==='orders-id'?orderSheet:deliverySheet]);}});
 const call=(query='?month='+month)=>handler({request:new Request('https://example.com/api/yandex/sad-order-review'+query,{headers:{Cookie:'session=test'}}),env});
 return {call,calls,get reads(){return reads;}};
}
test('SAD server review returns aggregate counts, no IDs or SKU revenue',async()=>{const f=fixture();const r=await f.call();assert.equal(r.status,200);const d=await r.json();assert.equal(d.code,'sad_order_review');assert.equal(d.matched,1);assert.equal(d.unmatched,0);assert.equal(d.skuIncomeVerified,false);assert.equal(d.netProfit,null);assert.equal(d.changedRecords,0);assert.equal(f.reads,2);assert.deepEqual(f.calls,['orders-id','sad-id']);assert.ok(!JSON.stringify(d).includes('orders-id'));});
test('SAD server review distinguishes missing registry and unavailable archives',async()=>{for(const [opts,reason] of [[{initial:[rows[1]]},'orders_registry_not_ready'],[{initial:[rows[0]]},'sad_realization_registry_not_ready'],[{fail:'sad-id'},'sad_archive_unavailable'],[{latest:[rows[0],{...rows[1],report_id:'new'}]},'report_registry_changed']]){const f=fixture(opts);assert.equal((await (await f.call()).json()).reason,reason);}});
test('SAD server review rejects unauthorized and invalid periods before reads',async()=>{const f=fixture({auth:{status:403,code:'forbidden'}});assert.equal((await f.call()).status,403);assert.equal(f.reads,0);const g=fixture();assert.equal((await g.call('?month=2026-11')).status,400);assert.equal(g.reads,0);});
