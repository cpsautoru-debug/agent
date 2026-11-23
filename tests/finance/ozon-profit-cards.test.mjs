import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOzonCards} from '../../web/office/profit-cards-core.js';
const month='2026-10';
const owner={month,source:'OWNER_STATEMENT_2026-11-23',
 taxKopecks:20550700,overheadKopecks:5400000};
const financeGroups=[
 ['Продажи',408967600],['Возвраты',-29917700],
 ['Вознаграждение Ozon',-176828607],
 ['Услуги доставки',-15289700],
 ['Продвижение и реклама',-33728488],
 ['Услуги партнёров',-4439510],
 ['Услуги FBO',-378840],
 ['Озон Технологии',-5600000],
 ['Другие услуги и штрафы',-7476764]
];
function evidence(){
 const total=135307991,known=80471000;
 return {
  result:{month,api:{totalKopecks:total},
   report:{totalKopecks:total,salesKopecks:408967600,
    returnsKopecks:-29917700,
    groups:financeGroups.map(([name,amountKopecks])=>({name,amountKopecks})),
    quantityVerified:true,periodVerified:true},
   costs:{knownKopecks:known,complete:true},
   dateCostEvidence:{complete:true,checkedSalesRows:227,confirmedSalesRows:227},
   profit:{blockers:['duplicate_candidates','api_unverified_or_incomplete',
     'allocation_missing','tax_register_missing']}},
  ready:{month,code:'ozon_finance_readiness',
   report:{complete:true,controlTotalKop:total},
   sourcesMatch:{apiVsXlsxKopecks:true},
   dailyParity:{code:'ozon_daily_totals_parity',match:true,readOnly:true,
    changedRecords:0,expectedDays:31,checkedDays:31},
   cogs:{complete:true,checkedSalesRows:227,confirmedSalesRows:227}}
 };
}
test('reconciles exactly nine Ozon report groups with real Oct 2026 amounts',()=>{
 const {result,ready}=evidence();
 const view=makeOzonCards(result,ready,owner);
 assert.equal(view.sourceConfirmed,true);
 assert.equal(view.costConfirmed,true);
 assert.equal(view.grossKopecks,298578900);
 assert.equal(view.operatingChannelKopecks,54836991);
 assert.equal(view.interimKopecks,54836991);
 assert.equal(view.netProfitKopecks,null);
 assert.equal(view.finalNetProfitVerified,false);
 const byName=Object.fromEntries(view.cards.map(c=>[c.label,c]));
 assert.match(byName['Валовая прибыль · управленческий P&L'].value,/2.*985.*789/);
 assert.match(byName['Комиссия Ozon'].value,/1.*768.*286,07/);
 assert.match(byName['Всего удержаний и услуг Ozon'].value,/2.*437.*419,09/);
 assert.match(byName['Результат Ozon после всех прямых затрат'].value,/548.*369,91/);
 assert.match(byName['Общие постоянные расходы бизнеса'].value,/54.*000/);
 assert.match(byName['Налог ИП за октябрь'].value,/205.*507/);
 assert.equal(byName['Чистая прибыль всего бизнеса'].value,'Ожидает закрытия');
});
test('incomplete financial groups, duplicated labels and cost errors stop gross calculation',()=>{
 for(const change of [
  x=>{x.ready.dailyParity.match=false;},
  x=>{x.ready.cogs.complete=false;},
  x=>{x.result.costs.knownKopecks=null;},
  x=>{x.result.profit.blockers.push('return_recovery_unverified');},
  x=>{x.ready.report.controlTotalKop++;},
  x=>{x.result.report.groups.pop();},
  x=>{x.result.report.groups.push({...x.result.report.groups[0]});},
  x=>{x.result.report.groups[0].amountKopecks++;},
  x=>{x.result.report.groups[2].amountKopecks=100;}
 ]){
  const x=evidence();change(x);
  const v=makeOzonCards(x.result,x.ready,owner);
  assert.equal(v.grossKopecks,null);
  assert.equal(v.interimKopecks,null);
 }
});
test('the IP tax stays in business summary, never a deduction from Ozon contribution',()=>{
 const x=evidence(),v=makeOzonCards(x.result,x.ready,owner);
 assert.equal(v.grossKopecks,298578900);
 assert.equal(v.operatingChannelKopecks,54836991);
 const monthChanged=makeOzonCards({...x.result,month:'2026-11'},
  {...x.ready,month:'2026-11'},owner);
 const tax=monthChanged.cards.find(c=>c.label==='Налог ИП за октябрь');
 assert.equal(tax.value,'Нет подтверждённой суммы');
});
test('no unverified gross profit is rendered when dates or API are incomplete',()=>{
 const x=evidence();x.result.dateCostEvidence.confirmedSalesRows=226;
 const view=makeOzonCards(x.result,x.ready,owner);
 assert.equal(view.grossKopecks,null);
 assert.equal(view.cards.find(c=>c.label.includes('Валовая прибыль')).value,'Требуется сверка');
});
