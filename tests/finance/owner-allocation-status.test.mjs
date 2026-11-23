import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeOctoberAllocation,describeOctoberAllocation,
 consolidatedIpAfterTax}
 from '../../web/office/owner-allocation-status.mjs';
test('owner tax and expenses remain visible without fabricated channel allocation',()=>{
 const s=summarizeOctoberAllocation();
 assert.equal(s.taxKopecks,20550700);
 assert.equal(s.overheadKopecks,5400000);
 assert.equal(s.taxAllocation,null);
 assert.equal(s.overheadAllocation,null);
 assert.equal(s.taxVerifiedByFNS,false);
 assert.equal(s.verifiedNetProfit,false);
 const t=describeOctoberAllocation(s);
 assert.match(t,/НЕ распределяется/);
 assert.match(t,/ОДИН РАЗ/);
 assert.match(t,/Подтверждённая чистая прибыль пока недоступна/);
});
test('full declared inputs calculate separate entity tax and business overhead',()=>{
 const s=summarizeOctoberAllocation({
  ipChannels:['ozon','wb'],allChannels:['ozon','wb','yandex','avito','offline'],
  taxIncome:{ozon:3,wb:1},
  revenue:{ozon:3,wb:1,yandex:2,avito:2,offline:2}
 });
 assert.equal(s.taxAllocation,null);
 assert.equal(s.taxAccountingMode,'entity_only_no_channel_allocation');
 assert.equal(s.overheadAllocation.allocatedTotalKopecks,5400000);
 assert.equal(s.taxAllocation,null);
 assert.equal(s.verifiedNetProfit,false);
});
test('unknown channel prevents ratio even if other income values exist',()=>{
 const s=summarizeOctoberAllocation({
  ipChannels:['ozon','wb'],allChannels:['ozon','wb'],
  taxIncome:{ozon:100000,wb:null},
  revenue:{ozon:100000,wb:null}
 });
 assert.equal(s.taxAllocation,null);
 assert.equal(s.overheadAllocation.status,'incomplete');
});
test('owner status is wired to the office without any persistence',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/owner-allocation-status.mjs',import.meta.url),'utf8');
 assert.match(html,/id="profitOwnerAllocation"/);
 assert.match(html,/owner-allocation-status.mjs/);
 assert.doesNotMatch(js,/localStorage|fetch\(|innerHTML|\.put\(|\.post\(/);
});

test('AUSN is deducted only once from complete consolidated IP profit',()=>{
 const x=consolidatedIpAfterTax({profitBeforeTaxKopecks:50000000,
   allIpChannelsComplete:true});
 assert.equal(x.status,'management_estimate');
 assert.equal(x.taxKopecks,20550700);
 assert.equal(x.profitAfterTaxKopecks,29449300);
 assert.equal(x.scope,'IP_ONLY');
 const missing=consolidatedIpAfterTax({profitBeforeTaxKopecks:50000000});
 assert.equal(missing.status,'incomplete');
 assert.equal(missing.profitAfterTaxKopecks,null);
});
