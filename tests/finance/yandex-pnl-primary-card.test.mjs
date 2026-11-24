import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {yandexPnlCardMetric} from '../../web/office/yandex-pnl-card.mjs';
import {consolidateBusinessPnl} from '../../web/office/consolidated-pnl-core.mjs';

const month='2026-10';
const legacy={yandex:{month,incomeKopecks:61779235,orders:79}};
test('third-party LLC Yandex income is excluded even if old interim exists',()=>{
 const result=yandexPnlCardMetric({id:'yandex',status:'unknown',
  profitKopecks:null},legacy,month);
 assert.equal(result.showIncome,false);
 assert.equal(result.primaryKopecks,null);
 assert.equal(result.meaning,'Нет расчёта ИП Жилиной');
});
test('Ozon and WB primary amounts do not change after legal-entity exclusion',()=>{
 const result=yandexPnlCardMetric({id:'ozon',status:'known_cost_result',
  profitKopecks:54836991},legacy,month);
 assert.equal(result.primaryKopecks,54836991);
 assert.equal(result.showIncome,false);
});
test('LLC figures never enter company P&L, shared taxes or reported profit',()=>{
 const pnl=consolidateBusinessPnl({month,channels:{
  ozon:{status:'known_cost_result',profitKopecks:54836991},
  wb:{status:'known_cost_result',profitKopecks:29149264}
 },sharedExpenses:[],taxes:[],completeSources:false});
 assert.equal(yandexPnlCardMetric(
  pnl.channels.find(x=>x.id==='yandex'),legacy,month).primaryKopecks,null);
 assert.equal(pnl.knownChannelsTotalKopecks,83986255);
 assert.equal(pnl.knownChannelCount,2);
 assert.equal(pnl.channelsTotalKopecks,null);
 assert.equal(pnl.finalProfitKopecks,null);
});
test('dashboard shows only properly separated IP costs and retains details',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const business=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(html,/Финансы бизнеса · все каналы/);
 assert.match(business,/Удержания и детализация WB/);
 assert.match(business,/Результат после известных затрат/);
 assert.match(business,/yandexPnlCardMetric\(ch,interim,pnl\.month\)/);
});
