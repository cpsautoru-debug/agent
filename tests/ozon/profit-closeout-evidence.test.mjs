import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../functions/api/ozon/profit-model.js',import.meta.url),'utf8');
const {calculateProfit}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const input=()=>({
 month:'2026-10',
 api:{totalKopecks:8000,records:2,coveredDays:31,days:31,netVerified:true,detailVerified:true,components:[],audit:[]},
 documents:{month:'2026-10',sourceName:'synthetic.xlsx',sourceSha256:'a'.repeat(64),
 quantityVerified:true,periodVerified:true,rows:[
 {row:2,date:'2026-10-03',service:'Выручка',group:'Продажи',sku:'S1',article:'A',name:'Test',quantity:2,amountKopecks:10000},
 {row:3,date:'2026-10-03',service:'Комиссия',group:'Комиссия',sku:'S1',article:'A',name:'Test',quantity:null,amountKopecks:-2000}
 ]},
 costs:{entries:[{sku:'S1',costKopecks:1000,validFrom:'2026-10-01',validTo:null,status:'confirmed',source:'source evidence',leatherDeliveryIncluded:false}]},
 expenses:{items:[],allocation:{method:'unallocated',shares:null,revenue:null,source:''}},
 tax:null
});
test('internally consistent operating estimate must not be marked audited net profit',()=>{
 const r=calculateProfit(input());
 assert.equal(r.profit.operatingKopecks,6000);
 assert.equal(r.profit.status,'preliminary');
 assert.equal(r.profit.netProfitVerified,false);
 assert.equal(r.profit.netEstimateKopecks,null);
 assert.equal(r.financeCloseout.netProfitVerified,false);
 assert.equal(r.financeCloseout.status,'not_verified');
 assert.equal(r.financeCloseout.checks.apiReconciled,true);
 assert.equal(r.financeCloseout.checks.datedManufacturingCostVerified,true);
 assert.equal(r.financeCloseout.checks.bankStatementReconciled,false);
 assert.equal(r.financeCloseout.checks.advertisingSourceReconciled,false);
 assert.equal(r.financeCloseout.checks.taxRegisterAudited,false);
});
test('even a calculated tax estimate cannot turn Ozon into audited profit',()=>{
 const d=input();
 d.tax={month:'2026-10',entity:'synthetic taxpayer',complete:true,source:'bank estimate',
 events:[{id:'income-1',date:'2026-10-10',kind:'income',amountKopecks:100000,source:'bank'}],
 ozonShareBps:10000,allocationSource:'estimated'};
 const r=calculateProfit(d);
 assert.equal(typeof r.profit.netEstimateKopecks,'number');
 assert.equal(r.profit.netProfitVerified,false);
 assert.equal(r.financeCloseout.checks.taxRegisterAudited,false);
 assert.ok(r.financeCloseout.missing.includes('taxRegisterAudited'));
});
test('unverified source coverage appears as missing evidence and never as zero cost',()=>{
 const d=input();d.documents.quantityVerified=false;
 const r=calculateProfit(d);
 assert.equal(r.financeCloseout.checks.datedManufacturingCostVerified,false);
 assert.ok(r.financeCloseout.missing.includes('datedManufacturingCostVerified'));
 assert.equal(r.profit.netProfitVerified,false);
});
test('office renders the actionable closeout checks',()=>{
 const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../web/office/profit.js',import.meta.url),'utf8');
 assert.match(html,/id="profitCloseoutChecklist"/);
 assert.match(html,/profit.js\?v=20261122-closeout-gates/);
 assert.match(js,/advertisingSourceReconciled/);
 assert.match(js,/bankStatementReconciled/);
 assert.match(js,/netProfitVerified===false/);
});
