import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {consolidateBusinessPnl} from '../../web/office/consolidated-pnl-core.mjs';
const month='2026-10';
const sharedExpenses=[
 {id:'waste',label:'Мусор',amountKopecks:900000},
 {id:'leather',label:'Доставка кожи',amountKopecks:2000000},
 {id:'ilya',label:'Зарплата Ильи',amountKopecks:2500000}
];
const taxes=[{id:'ip-ausn',label:'АУСН ИП',entity:'ip',amountKopecks:20550700}];
test('separate channel results, one consolidated tax, one shared charge',()=>{
 const channels={ozon:{status:'verified',profitKopecks:54836991},
  wb:{status:'verified',profitKopecks:30000000},
  yandex:{status:'verified',profitKopecks:10000000},
  avito:{status:'verified',profitKopecks:5000000},
  offline:{status:'verified',profitKopecks:2000000}};
 const r=consolidateBusinessPnl({month,channels,sharedExpenses,taxes,
  completeSources:true,sharedExpensesComplete:true,taxesComplete:true});
 assert.equal(r.channelsTotalKopecks,101836991);
 assert.equal(r.sharedExpenseTotalKopecks,5400000);
 assert.equal(r.taxTotalKopecks,20550700);
 assert.equal(r.finalProfitKopecks,75886291);
 assert.equal(r.status,'verified');
});
test('missing channels suppress the business bottom line rather than zero-fill',()=>{
 const r=consolidateBusinessPnl({month,
  channels:{ozon:{status:'known_cost_result',profitKopecks:54836991}},
  sharedExpenses,taxes});
 assert.equal(r.channels[0].profitKopecks,54836991);
 assert.equal(r.channelsTotalKopecks,null);
 assert.equal(r.finalProfitKopecks,null);
 assert.deepEqual(r.missingChannels,['wb','yandex','avito','offline']);
 assert.equal(r.taxTotalKopecks,20550700);
 assert.equal(r.verified,false);
});
test('business tax and expenses cannot be doubled up as separate rows',()=>{
 assert.throws(()=>consolidateBusinessPnl({
  month,channels:{},sharedExpenses,taxes:[
    {id:'waste',label:'Duplicate tax',entity:'ip',amountKopecks:20550700}
  ]
 }),/pnl_expense_invalid/);
});
test('external LLC tax must never be included in IP Zhilina profit',()=>{
 assert.throws(()=>consolidateBusinessPnl({
  month,channels:{},sharedExpenses:[],
  taxes:[{id:'wrong-llc',label:'Налог чужого ООО',
   entity:'ooo',amountKopecks:500000}]
 }),/pnl_expense_invalid/);
});
test('dashboard includes separated channels and tax section',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 assert.match(html,/id="businessPnl"/);
 assert.match(html,/business-pnl.mjs/);
 assert.match(html,/business-pnl.css/);
});

test('known taxes do not imply all entity taxes and common costs are complete',()=>{
 const channels=Object.fromEntries(['ozon','wb','yandex','avito','offline']
   .map(id=>[id,{status:'verified',profitKopecks:100000}]));
 const r=consolidateBusinessPnl({month,channels,sharedExpenses,taxes});
 assert.equal(r.channelsTotalKopecks,500000);
 assert.equal(r.sharedExpenseTotalKopecks,5400000);
 assert.equal(r.taxTotalKopecks,20550700);
 assert.equal(r.finalProfitKopecks,null);
 assert.equal(r.verified,false);
});
test('unknown months do not silently display zero expenses or taxes',()=>{
 const r=consolidateBusinessPnl({month:'2026-11',channels:{},sharedExpenses:[],taxes:[]});
 assert.equal(r.sharedExpenseTotalKopecks,null);
 assert.equal(r.taxTotalKopecks,null);
 assert.equal(r.finalProfitKopecks,null);
});

test('October Ozon and WB contributions appear as a partial sum, not business net',()=>{
 const r=consolidateBusinessPnl({month,channels:{
  ozon:{status:'known_cost_result',profitKopecks:54836991},
  wb:{status:'known_cost_result',profitKopecks:29149264}
 },sharedExpenses,taxes});
 assert.equal(r.knownChannelCount,2);
 assert.equal(r.knownChannelsTotalKopecks,83986255);
 assert.equal(r.visibleRowsRemainderKopecks,58035555);
 assert.equal(r.visibleRowsRemainderIsProfit,false);
 assert.equal(r.channelsTotalKopecks,null);
 assert.equal(r.finalProfitKopecks,null);
 assert.deepEqual(r.missingChannels,['yandex','avito','offline']);
 assert.equal(r.sharedExpenseTotalKopecks,5400000);
 assert.equal(r.taxTotalKopecks,20550700);
 assert.equal(r.visibleRowsRemainderKopecks,58035555);
});
