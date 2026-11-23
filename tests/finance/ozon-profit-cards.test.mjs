import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOzonCards} from '../../web/office/profit-cards-core.js';
const month='2026-10';
const owner={month,source:'OWNER_STATEMENT_2026-11-23',
 taxKopecks:20550700,overheadKopecks:5400000};
function evidence(){
 const total=135307991,known=80471000;
 return {
  result:{month,
   api:{totalKopecks:total},
   report:{totalKopecks:total,salesKopecks:408967600,
    returnsKopecks:-29917700,quantityVerified:true,periodVerified:true},
   costs:{knownKopecks:known,complete:true},
   dateCostEvidence:{complete:true,checkedSalesRows:227,confirmedSalesRows:227},
   profit:{blockers:['duplicate_candidates','api_unverified_or_incomplete',
     'allocation_missing','tax_register_missing']}},
  ready:{month,code:'ozon_finance_readiness',
   report:{complete:true,controlTotalKop:total},
   sourcesMatch:{apiVsXlsxKopecks:true},
   dailyParity:{code:'ozon_daily_totals_parity',match:true,
    expectedDays:31,checkedDays:31},
   cogs:{complete:true,checkedSalesRows:227,confirmedSalesRows:227}}
 };
}
test('Ozon displays exact known-cost result while tax stays entity-only',()=>{
 const {result,ready}=evidence();
 const view=makeOzonCards(result,ready,owner);
 assert.equal(view.interimKopecks,54836991);
 assert.equal(view.sourceConfirmed,true);
 assert.equal(view.costConfirmed,true);
 assert.equal(view.finalNetProfitVerified,false);
 assert.match(view.cards[4].value,/548.*369,91/);
 assert.match(view.cards[7].detail,/общем P&L ИП/);
 assert.match(view.cards[8].detail,/без повторного вычета/);
 assert.equal(view.cards[9].value,'Не подтверждена');
 assert.equal(view.cards.some(x=>x.value==='Неизвестно'),false);
});
test('missing daily parity or COGS blocks contribution without inventing zero',()=>{
 for(const change of [
  x=>{x.ready.dailyParity.match=false;},
  x=>{x.ready.cogs.complete=false;},
  x=>{x.result.costs.knownKopecks=null;},
  x=>{x.result.profit.blockers.push('return_recovery_unverified');},
  x=>{x.ready.report.controlTotalKop++;}
 ]){
  const x=evidence();change(x);
  const result=makeOzonCards(x.result,x.ready,owner);
  assert.equal(result.interimKopecks,null);
  assert.equal(result.cards[4].value,'Ожидает сверки');
 }
});
test('entity tax is not attributed to Ozon for other periods or wrong source',()=>{
 const x=evidence();
 x.result.month='2026-11';
 x.ready.month='2026-11';
 const view=makeOzonCards(x.result,x.ready,owner);
 assert.equal(view.cards[7].value,'В общей сводке');
 const altered=makeOzonCards(evidence().result,evidence().ready,
  {...owner,source:'unverified'});
 assert.equal(altered.cards[7].value,'В общей сводке');
});
