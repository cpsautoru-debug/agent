import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMarketplaceCoverage} from '../functions/api/orders/fulfillment-source-coverage.mjs';

const now=Date.parse('2026-11-26T04:30:00Z');
const row=(source,coverage,age=1000)=>({source,coverage,rows_seen:0,last_success_at:new Date(now-age).toISOString()});
const scope=[
 row('ozon','FBS_AWAITING_PACKAGING_LAST_7_DAYS_COMPLETE'),
 row('wb','WB_NEW_FBS_ORDERS_API_SNAPSHOT'),
 row('yandex','BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE'),
 row('manual','MANUAL_MARKED_CUSTOMERORDERS_COMPLETE')
];
test('date-scoped zero-order feeds never certify all outstanding obligations',()=>{
 const x=assessMarketplaceCoverage(scope,{now});
 assert.equal(x.complete,false);
 assert.equal(x.reason,'marketplace_coverage_unverified');
 assert.equal(x.sources.length,4);
 assert.ok(x.sources.every(s=>s.reason==='time_or_status_scoped_only'));
});
test('missing and stale sources fail closed regardless of other providers',()=>{
 const missing=assessMarketplaceCoverage(scope.slice(0,3),{now});
 assert.equal(missing.complete,false);
 assert.equal(missing.sources[3].reason,'source_missing');
 const stale=assessMarketplaceCoverage(scope.map(x=>({...x,last_success_at:new Date(now-3600000).toISOString()})),{now});
 assert.ok(stale.sources.every(x=>x.reason==='source_snapshot_stale'));
});
test('an explicitly complete full-open scope is necessary for allocation',()=>{
 const proof=[
  row('ozon','ALL_OPEN_OZON_FBS_VERIFIED'),
  row('wb','ALL_OPEN_WB_FBS_VERIFIED'),
  row('yandex','ALL_OPEN_YANDEX_BOTH_CAMPAIGNS_VERIFIED'),
  row('manual','ALL_OPEN_MANUAL_CUSTOMERORDERS_VERIFIED')
 ];
 assert.equal(assessMarketplaceCoverage(proof,{now}).complete,true);
 assert.equal(assessMarketplaceCoverage(proof.map((x,i)=>i===1?{...x,rows_seen:null}:x),{now}).complete,false);
});
