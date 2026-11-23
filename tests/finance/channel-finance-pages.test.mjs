import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('finance pages contain Ozon ratios and the detailed WB report controls',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 for(const value of ['profitOzonRates','wbManagementProfit','wbProfitMonth',
  'wbProfitReload','wbProfitCards','wbProfitComparison',
  'ozon-management-metrics.mjs','wb-management-profit.mjs'])
  assert.match(html,new RegExp(value));
});
test('WB management uses restricted month settlement API without mutation',()=>{
 const source=readFileSync(new URL('../../web/office/wb-management-profit.mjs',import.meta.url),'utf8');
 assert.match(source,/api\/wb\/month-settlement/);
 assert.match(source,/НЕ является прибылью/);
 assert.doesNotMatch(source,/method:'POST'|localStorage|innerHTML/);
});
test('Ozon ratios are connected to the owner finance refresh',()=>{
 const source=readFileSync(new URL('../../web/office/profit.js',import.meta.url),'utf8');
 assert.match(source,/OzonFinanceMetrics\?\.update\(result,readiness\)/);
});
