import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../functions/api/ozon/profit-model.js',import.meta.url),'utf8');
const {calculateProfit}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const month='2026-10';
const doc=(rows)=>({month,sourceName:'synthetic-october.xlsx',
  sourceSha256:'a'.repeat(64),quantityVerified:true,periodVerified:true,rows});
const line=(row,service,group,amountKopecks,extra={})=>({
  row,date:'2026-10-11',service,group,sku:null,article:null,
  name:null,quantity:null,amountKopecks,...extra
});
const advertising=(id='external-ads')=>({
  id,label:'Реклама Ozon трафик',amountKopecks:500,
  scope:'ozon',validFrom:'2026-10-01',validTo:null,leatherDelivery:false
});
const calc=(rows,items)=>calculateProfit({
  month,
  api:{totalKopecks:rows.reduce((sum,r)=>sum+r.amountKopecks,0),
    records:rows.length,coveredDays:31,days:31,
    netVerified:true,detailVerified:true,components:[],audit:[]},
  documents:doc(rows),costs:{entries:[{
    sku:'S1',validFrom:'2026-09-01',validTo:null,
    costKopecks:1000,status:'confirmed',source:'Synthetic confirmed',
    leatherDeliveryIncluded:false
  }]},
  expenses:{items,allocation:{method:'unallocated',shares:null,revenue:null,source:''}},
  tax:null
});
const sale=line(1,'Выручка','Продажи',5000,{
  sku:'S1',article:'a',name:'synthetic',quantity:1
});
test('ad expenses already present in the Ozon report cannot silently be deducted again',()=>{
  const result=calc([sale,line(2,'Продвижение товаров','Продвижение',-700)],
    [advertising()]);
  assert.equal(result.advertisingAudit.possibleDoubleCount,true);
  assert.equal(result.advertisingAudit.duplicateConfirmed,false);
  assert.equal(result.advertisingAudit.advertisingSpendVerified,false);
  assert.equal(result.advertisingAudit.reportAdvertisingRows.length,1);
  assert.equal(result.advertisingAudit.externalAdvertisingItems.length,1);
  assert.equal(result.advertisingAudit.reportAdvertisingRows[0].amountKopecks,-700);
  assert.ok(result.profit.blockers.includes('advertising_overlap_unverified'));
  assert.equal(result.profit.operatingKopecks,null);
  assert.equal(result.profit.netEstimateKopecks,null);
  assert.equal(result.costs.knownKopecks,1000);
});
test('expense outside selected month does not trigger false positive',()=>{
  const item={...advertising(),validFrom:'2026-11-01'};
  const result=calc([sale,line(2,'Реклама','Продвижение',-700)],[item]);
  assert.equal(result.advertisingAudit.possibleDoubleCount,false);
  assert.equal(result.advertisingAudit.externalAdvertisingItems.length,0);
  assert.equal(result.advertisingAudit.advertisingSpendVerified,false);
});
test('no ad overlap does not mean advertising completeness',()=>{
  const result=calc([sale],[advertising()]);
  assert.equal(result.advertisingAudit.reportAvailable,true);
  assert.equal(result.advertisingAudit.reportAdvertisingRows.length,0);
  assert.equal(result.advertisingAudit.advertisingSpendVerified,false);
  assert.equal(result.advertisingAudit.duplicateConfirmed,false);
});
test('Ozon advertising UI remains informational and read-only',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/profit.js',import.meta.url),'utf8');
  assert.match(html,/id="profitAdvertisingAudit"/);
  assert.match(html,/profit.js\?v=20261122-closeout-gates/);
  assert.match(ui,/advertising_overlap_unverified/);
  assert.match(ui,/ad\.advertisingSpendVerified===false/);
});
