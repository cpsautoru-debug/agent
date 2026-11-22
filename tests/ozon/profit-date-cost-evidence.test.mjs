import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../functions/api/ozon/profit-model.js',import.meta.url),'utf8');
const {calculateProfit}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const entry=(sku,status,from,to=null,price=1000)=>({
  sku,costKopecks:price,validFrom:from,validTo:to,status,
  source:'Подтверждённые данные производства',leatherDeliveryIncluded:false
});
const sale=(row,date,sku,quantity=1)=>({
  row,date,service:'Выручка',group:'Продажи',sku,
  article:'TEST',name:'Synthetic',quantity,amountKopecks:2000
});
const input=(rows,costs)=>({
  month:'2026-10',api:{totalKopecks:rows.reduce((a,r)=>a+r.amountKopecks,0),
    records:rows.length,coveredDays:31,days:31,netVerified:true,
    detailVerified:true,components:[],audit:[]},
  documents:{month:'2026-10',sourceName:'synthetic.xlsx',
    sourceSha256:'a'.repeat(64),quantityVerified:true,periodVerified:true,rows},
  costs:{entries:costs},expenses:{items:[],allocation:{
    method:'unallocated',shares:null,revenue:null,source:''}},tax:null
});
test('each sale row names its matched cost version on the actual operation date',()=>{
  const rows=[sale(2,'2026-10-04','A',2),sale(3,'2026-10-20','A',1)];
  const costs=[entry('A','confirmed','2026-10-01','2026-10-15',1000),
    entry('A','confirmed','2026-10-16',null,1800)];
  const result=calculateProfit(input(rows,costs));
  const e=result.dateCostEvidence;
  assert.equal(e.checkedSalesRows,2);
  assert.equal(e.confirmedSalesRows,2);
  assert.equal(e.unverifiedSalesRows,0);
  assert.equal(e.complete,true);
  assert.deepEqual(e.rows.map(x=>x.unitCostKopecks),[1000,1800]);
  assert.deepEqual(e.rows.map(x=>x.costVersionFrom),
    ['2026-10-01','2026-10-16']);
  assert.equal(result.costs.soldKopecks,3800);
  assert.equal(result.profit.netEstimateKopecks,null);
});
test('preliminary, missing-date price, missing SKU and unknown quantity are not confirmed',()=>{
  const rows=[sale(2,'2026-10-05','A'),sale(3,'2026-10-20','A'),
    sale(4,'2026-10-07','B'),sale(5,'2026-10-07',null),
    sale(6,'2026-10-07','C',null)];
  const costs=[entry('A','preliminary','2026-10-01','2026-10-10'),
    entry('C','confirmed','2026-10-01')];
  const e=calculateProfit(input(rows,costs)).dateCostEvidence;
  assert.equal(e.checkedSalesRows,5);
  assert.equal(e.confirmedSalesRows,0);
  assert.deepEqual(e.rows.map(x=>x.status),
    ['matched_preliminary','cost_missing','cost_missing','sku_missing','quantity_missing']);
  assert.equal(e.complete,false);
});
test('return row is not mistaken for a new sale-date cost assertion',()=>{
  const rows=[sale(2,'2026-10-03','A'),
    {...sale(3,'2026-10-04','A'),service:'Возврат выручки',
      group:'Возвраты',amountKopecks:-2000}];
  const result=calculateProfit(input(rows,[entry('A','confirmed','2026-10-01')]));
  assert.equal(result.dateCostEvidence.checkedSalesRows,1);
  assert.equal(result.dateCostEvidence.rows[0].sourceRow,2);
  assert.ok(result.profit.blockers.includes('return_recovery_unverified'));
  assert.equal(result.profit.operatingKopecks,null);
});
test('office renders an evidence table, not a claim of audited profit',()=>{
  const html=readFileSync(new URL('../../web/office/index.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../../web/office/profit.js',import.meta.url),'utf8');
  assert.match(html,/id="profitDateCostEvidenceRows"/);
  assert.match(html,/id="profitDateCostEvidenceStatus"/);
  assert.match(html,/profit.js\?v=20261122-ad-overlap/);
  assert.match(ui,/dated\.confirmedSalesRows/);
  assert.match(ui,/Возвраты проверяются отдельно/);
  assert.match(ui,/Построчная сверка|построчная сверка/);
});
