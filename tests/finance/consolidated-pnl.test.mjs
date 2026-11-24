import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {consolidateBusinessPnl,PNL_CHANNELS}
 from '../../web/office/consolidated-pnl-core.mjs';
import {applyYandexCostToChannels}
 from '../../web/office/marketplace-channel-scope.mjs';
const month='2026-10';
const sharedExpenses=[
 {id:'waste',label:'Мусор',amountKopecks:900000},
 {id:'leather',label:'Доставка кожи',amountKopecks:2000000},
 {id:'ilya',label:'Зарплата Ильи',amountKopecks:2500000}
];
const taxes=[{id:'ip-ausn',label:'АУСН ИП',entity:'ip',amountKopecks:20550700}];
const validChannels={
 ozon:{status:'verified',profitKopecks:54836991},
 wb:{status:'verified',profitKopecks:29149264},
 yandex:{status:'verified',profitKopecks:10000000}
};
test('only the three marketplace channels are in this P&L',()=>{
 assert.deepEqual(PNL_CHANNELS,['ozon','wb','yandex']);
 const x=consolidateBusinessPnl({month,
  channels:{...validChannels,
   avito:{status:'verified',profitKopecks:900000000},
   offline:{status:'verified',profitKopecks:800000000}
  },sharedExpenses,taxes,
  completeSources:true,sharedExpensesComplete:true,taxesComplete:true});
 assert.equal(x.channels.length,3);
 assert.equal(x.channelsTotalKopecks,93986255);
 assert.equal(x.finalProfitKopecks,68035555);
 assert.equal(x.knownChannelCount,3);
 assert.equal(x.status,'verified');
});
test('unknown Yandex blocks net but not verified Ozon+WB contributions',()=>{
 const x=consolidateBusinessPnl({month,
  channels:{ozon:{status:'known_cost_result',profitKopecks:54836991},
    wb:{status:'known_cost_result',profitKopecks:29149264}},
  sharedExpenses,taxes});
 assert.equal(x.knownChannelCount,2);
 assert.equal(x.knownChannelsTotalKopecks,83986255);
 assert.equal(x.channelsTotalKopecks,null);
 assert.equal(x.provisionalAfterExpensesKopecks,null);
 assert.equal(x.visibleRowsRemainderKopecks,58035555);
 assert.equal(x.visibleRowsRemainderIsProfit,false);
 assert.equal(x.finalProfitKopecks,null);
 assert.deepEqual(x.missingChannels,['yandex']);
});
test('three provisional channels yield one provisional remainder after extras and IP tax',()=>{
 const x=consolidateBusinessPnl({month,channels:{
  ozon:{status:'known_cost_result',profitKopecks:54836991},
  wb:{status:'known_cost_result',profitKopecks:29149264},
  yandex:{status:'known_cost_result',profitKopecks:10000000}
 },sharedExpenses,taxes});
 assert.equal(x.channelsTotalKopecks,93986255);
 assert.equal(x.provisionalAfterExpensesKopecks,68035555);
 assert.equal(x.provisionalAfterExpensesIsNetProfit,false);
 assert.equal(x.finalProfitKopecks,null);
 assert.equal(x.status,'management_estimate');
 assert.deepEqual(x.missingChannels,[]);
});
test('fully reconciled net requires all three verified and complete global expenses and tax',()=>{
 const incomplete=consolidateBusinessPnl({month,
  channels:validChannels,sharedExpenses,taxes,completeSources:true});
 assert.equal(incomplete.provisionalAfterExpensesKopecks,68035555);
 assert.equal(incomplete.finalProfitKopecks,null);
 const complete=consolidateBusinessPnl({month,channels:validChannels,
  sharedExpenses,taxes,completeSources:true,
  sharedExpensesComplete:true,taxesComplete:true});
 assert.equal(complete.finalProfitKopecks,68035555);
 assert.equal(complete.status,'verified');
});
test('account-level tax and shared expenses are deducted once, duplicates rejected',()=>{
 const x=consolidateBusinessPnl({month,channels:validChannels,
  sharedExpenses,taxes,completeSources:true,
  sharedExpensesComplete:true,taxesComplete:true});
 assert.equal(x.sharedExpenseTotalKopecks,5400000);
 assert.equal(x.taxTotalKopecks,20550700);
 assert.equal(x.channelsTotalKopecks-x.sharedExpenseTotalKopecks-
  x.taxTotalKopecks,x.finalProfitKopecks);
 assert.throws(()=>consolidateBusinessPnl({month,channels:{},
  sharedExpenses,taxes:[{id:'waste',label:'Duplicate',entity:'ip',
   amountKopecks:20550700}]}),/pnl_expense_invalid/);
 assert.throws(()=>consolidateBusinessPnl({month,channels:{},
  sharedExpenses:[],taxes:[{id:'foreign',label:'ООО',entity:'ooo',
   amountKopecks:10000}]}),/pnl_expense_invalid/);
});
test('known unit-cost Yandex evidence may enter provisional but never verified profit',()=>{
 const channels={ozon:{status:'known_cost_result',profitKopecks:54836991},
  wb:{status:'known_cost_result',profitKopecks:29149264}};
 assert.equal(applyYandexCostToChannels(channels,month,{
  month,status:'preliminary_cost_reconciled',
  preliminaryContributionKopecks:20000000,cogsKopecks:40000000,
  missingCount:0,netProfitKopecks:null}),true);
 assert.equal(channels.yandex.status,'known_cost_result');
 const r=consolidateBusinessPnl({month,channels,sharedExpenses,taxes});
 assert.equal(r.channelsTotalKopecks,103986255);
 assert.equal(r.provisionalAfterExpensesKopecks,78035555);
 assert.equal(r.finalProfitKopecks,null);
 assert.equal(applyYandexCostToChannels(channels,month,{
  month,status:'incomplete_cost_coverage',missingCount:2,
  preliminaryContributionKopecks:null,netProfitKopecks:null}),false);
 assert.equal(channels.yandex,undefined);
});
test('unknown months or expenses never pretend to be zero',()=>{
 const x=consolidateBusinessPnl({month:'2026-11',
  channels:{},sharedExpenses:[],taxes:[]});
 assert.equal(x.channelsTotalKopecks,null);
 assert.equal(x.sharedExpenseTotalKopecks,null);
 assert.equal(x.taxTotalKopecks,null);
 assert.equal(x.provisionalAfterExpensesKopecks,null);
 assert.equal(x.finalProfitKopecks,null);
});
test('page includes three-channel layout and known cost subtotal',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(html,/id="businessPnl"/);
 assert.match(js,/applyYandexCostToChannels/);
 assert.match(js,/pnl\.provisionalAfterExpensesKopecks/);
});
