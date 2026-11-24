import test from 'node:test';
import assert from 'node:assert/strict';
import {yandexPnlCardMetric} from '../../web/office/yandex-pnl-card.mjs';
import {consolidateBusinessPnl} from '../../web/office/consolidated-pnl-core.mjs';
import {readFileSync} from 'node:fs';

const month='2026-10';
const channel={id:'yandex',status:'unknown',profitKopecks:null};
test('Yandex post-fee income is the FIRST card amount, not No data',()=>{
 const metric=yandexPnlCardMetric(channel,{
  yandex:{month,incomeKopecks:61779235,orders:79}},month);
 assert.equal(metric.showIncome,true);
 assert.equal(metric.primaryKopecks,61779235);
 assert.match(metric.meaning,/НЕ чистая прибыль/);
 assert.match(metric.note,/Оба магазина ИП Жилиной Ольги/);
 assert.match(metric.note,/79 заказов/);
});
test('verified Yandex SKU contribution becomes primary, income becomes detail',()=>{
 const ch={id:'yandex',status:'known_cost_result',
  profitKopecks:29779235};
 const x=yandexPnlCardMetric(ch,{
  yandex:{month,incomeKopecks:61779235,orders:79},
  yandexCost:{month,status:'preliminary_cost_reconciled',
   cogsKopecks:32000000,preliminaryContributionKopecks:29779235,
   missingCount:0,netProfitKopecks:null}
 },month);
 assert.equal(x.primaryKopecks,29779235);
 assert.equal(x.incomeKopecks,61779235);
 assert.match(x.meaning,/НЕ чистая прибыль/);
 assert.equal(x.showIncome,true);
});
test('rejected unverified or previous-month data does not appear in card',()=>{
 for(const invalid of [
  null,{yandex:{month:'2026-09',incomeKopecks:61779235,orders:79}},
  {yandex:{month,incomeKopecks:null,orders:79}},
  {yandex:{month,incomeKopecks:61779235,orders:0}}
 ]){
  const r=yandexPnlCardMetric(channel,invalid,month);
  assert.equal(r.showIncome,false);
  assert.equal(r.primaryKopecks,null);
 }
});
test('Ozon and WB primary contribution remains unchanged',()=>{
 const other={id:'ozon',status:'known_cost_result',profitKopecks:54836991};
 const r=yandexPnlCardMetric(other,{
  yandex:{month,incomeKopecks:61779235,orders:79}},month);
 assert.equal(r.primaryKopecks,54836991);
 assert.equal(r.showIncome,false);
});
test('Yandex income never contaminates P&L total, shared tax or channel contribution',()=>{
 const pnl=consolidateBusinessPnl({
  month,channels:{
   ozon:{status:'known_cost_result',profitKopecks:54836991},
   wb:{status:'known_cost_result',profitKopecks:29149264}
  },sharedExpenses:[],taxes:[],completeSources:false});
 assert.equal(yandexPnlCardMetric(pnl.channels.find(x=>x.id==='yandex'),
  {yandex:{month,incomeKopecks:61779235,orders:79}},month)
  .primaryKopecks,61779235);
 assert.equal(pnl.knownChannelsTotalKopecks,83986255);
 assert.equal(pnl.knownChannelCount,2);
 assert.equal(pnl.channelsTotalKopecks,null);
 assert.equal(pnl.finalProfitKopecks,null);
});
test('actual business P&L uses the primary card metric once and no duplicated intermediary',()=>{
 const s=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(s,/yandexPnlCardMetric\(ch,interim,pnl\.month\)/);
 assert.match(s,/money\(metric\.primaryKopecks\)/);
 assert.match(s,/metric\.meaning/);
 assert.doesNotMatch(s,/business-pnl-interim-value.*interim\.yandex\.incomeKopecks/s);
});

test('financial dashboard labels WB intermediate separately and folds long detail',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const business=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(html,/Финансы маркетплейсов · Ozon, WB, Яндекс/);
 assert.match(business,/Удержания и детализация WB/);
 assert.match(business,/После удержаний WB, ДО себестоимости/);
 assert.match(business,/Результат после известных затрат/);
 assert.match(business,/pnl\.channels\.filter\(c=>c\.status!=='unknown'\)/);
 assert.match(business,/metric\.primaryKopecks/);
});
