import test from 'node:test';
import assert from 'node:assert/strict';
import {readOctoberBusinessOverhead}
 from '../../web/office/business-overhead-core.mjs';
import {consolidateBusinessPnl}
 from '../../web/office/consolidated-pnl-core.mjs';
import {readFileSync} from 'node:fs';
const month='2026-10';
const source=()=>({
 code:'unified_finance_source_audit',month,readOnly:true,
 expenses:{status:'ready',version:4,items:[
  {id:'waste',label:'Мусор',scope:'business',amountKopecks:900000,
   validFrom:'2026-10-01',validTo:null},
  {id:'leather',label:'Доставка кожи',scope:'business',
   amountKopecks:2000000,validFrom:'2026-10-01',validTo:null},
  {id:'ilya',label:'Зарплата Ильи',scope:'business',
   amountKopecks:2500000,validFrom:'2026-10-01',validTo:null},
  {id:'external-ozon',label:'Реклама Ozon',scope:'ozon',
   amountKopecks:3000000,validFrom:'2026-10-01',validTo:null}
 ]},
 ozonProfit:{entries:[{leatherDeliveryIncluded:false}]}
});
const tax=[{id:'ip',label:'АУСН ИП',entity:'ip',amountKopecks:20550700}];
test('shared D1 ledger contains only business expenses, not Ozon direct ads',()=>{
 const x=readOctoberBusinessOverhead(month,source());
 assert.equal(x.items.length,3);
 assert.equal(x.version,4);
 assert.equal(x.freightOverlapPossible,false);
 assert.equal(x.items.reduce((s,a)=>s+a.amountKopecks,0),5400000);
 assert.deepEqual(x.items.map(a=>a.label),
  ['Мусор','Доставка кожи','Зарплата Ильи']);
});
test('tax and common expenses deducted once after all three channel contributions',()=>{
 const costs=readOctoberBusinessOverhead(month,source());
 const pnl=consolidateBusinessPnl({
  month,channels:{
   ozon:{status:'known_cost_result',profitKopecks:54836991},
   wb:{status:'known_cost_result',profitKopecks:29149264},
   yandex:{status:'known_cost_result',profitKopecks:22000000}
  },sharedExpenses:costs.items,taxes:tax});
 assert.equal(pnl.provisionalAfterExpensesKopecks,80035555);
 assert.equal(pnl.finalProfitKopecks,null);
 assert.equal(pnl.sharedExpenseTotalKopecks,5400000);
});
test('unknown or possibly embedded freight cannot certify an exhaustive net margin',()=>{
 const a=source();a.ozonProfit.entries[0].leatherDeliveryIncluded=true;
 assert.equal(readOctoberBusinessOverhead(month,a).freightOverlapPossible,true);
 const b=source();b.expenses.items.push({...b.expenses.items[0]});
 assert.equal(readOctoberBusinessOverhead(month,b),null);
 const c=source();c.expenses.status='unavailable';
 assert.equal(readOctoberBusinessOverhead(month,c),null);
});
test('future periods do not silently inherit October shared ledger',()=>{
 assert.equal(readOctoberBusinessOverhead('2026-11',source()),null);
});
test('dashboard fetches the actual business ledger and preserves one-time tax deduction',()=>{
 const src=readFileSync(new URL('../../web/office/business-pnl.mjs',import.meta.url),'utf8');
 assert.match(src,/readOctoberBusinessOverhead/);
 assert.match(src,/api\/finance\/cost-audit/);
 assert.match(src,/base\.sharedExpenses=ledger\.items/);
 assert.match(src,/consolidateBusinessPnl\(base\)/);
});
