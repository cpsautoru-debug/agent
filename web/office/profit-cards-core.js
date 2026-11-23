// Read-only owner P&L presentation. The exact profit API remains unchanged.
// No "zero" substitutes, no separate IP tax allocation to Ozon.
function makeOzonCards(result,readiness,ownerAmounts){
 const ok=n=>Number.isSafeInteger(n);
 const r=result||{},a=r.api||{},report=r.report||{},cost=r.costs||{},
   dated=r.dateCostEvidence||{},rr=readiness||{};
 const month=r.month;
 const sourceConfirmed=rr.month===month&&rr.code==='ozon_finance_readiness'&&
   rr.sourcesMatch?.apiVsXlsxKopecks===true&&
   rr.dailyParity?.code==='ozon_daily_totals_parity'&&
   rr.dailyParity?.match===true&&
   rr.dailyParity?.checkedDays===rr.dailyParity?.expectedDays&&
   rr.dailyParity?.expectedDays>0&&
   rr.report?.complete===true&&
   ok(a.totalKopecks)&&a.totalKopecks===report.totalKopecks&&
   rr.report?.controlTotalKop===a.totalKopecks&&
   report.quantityVerified===true&&report.periodVerified===true;
 const costConfirmed=sourceConfirmed&&cost.complete===true&&
   rr.cogs?.complete===true&&dated.complete===true&&
   dated.checkedSalesRows>0&&
   dated.checkedSalesRows===dated.confirmedSalesRows&&
   rr.cogs.checkedSalesRows===dated.checkedSalesRows&&
   rr.cogs.confirmedSalesRows===dated.confirmedSalesRows&&
   ok(cost.knownKopecks)&&cost.knownKopecks>=0;
 const unsafe=['return_recovery_unverified','unknown_services',
   'sku_missing','cost_missing','cost_preliminary','quantity_missing',
   'report_api_mismatch','quantity_unverified','period_unverified'];
 const costBlockers=Array.isArray(r.profit?.blockers)?
   unsafe.some(x=>r.profit.blockers.includes(x)):true;
 const verifiedIntermediate=costConfirmed&&!costBlockers&&
   ok(a.totalKopecks-cost.knownKopecks);
 const money=n=>n===null?'':new Intl.NumberFormat('ru-RU',
   {style:'currency',currency:'RUB'}).format(n/100);
 const box=(label,value,detail,kind='normal')=>({label,value,detail,kind});
 const amount=(n,confirmed)=>confirmed&&ok(n)?money(n):'Требуется сверка';
 const known=month==='2026-10'&&ownerAmounts&&
   ownerAmounts.month==='2026-10'&&
   ownerAmounts.source==='OWNER_STATEMENT_2026-11-23'&&
   ownerAmounts.taxKopecks===20550700&&
   ownerAmounts.overheadKopecks===5400000;
 return {
  cards:[
   box('Продажи · отчёт Ozon',amount(report.salesKopecks,sourceConfirmed),
     'Исходный показатель отчёта, до удержаний'),
   box('Возвраты · отчёт Ozon',amount(report.returnsKopecks,sourceConfirmed),
     'Отдельно от расходов и комиссий'),
   box('Сальдо после удержаний Ozon',amount(a.totalKopecks,sourceConfirmed),
     'Комиссии, логистика и начисленная реклама уже отражены в сальдо'),
   box('Себестоимость с учётом возвратов',
     amount(cost.knownKopecks,verifiedIntermediate),
     'Подтверждена на дату продажи; возвращённые товары проверены'),
   box('Результат после удержаний и себестоимости',
     verifiedIntermediate?money(a.totalKopecks-cost.knownKopecks):
       'Ожидает сверки',
     'Промежуточный результат. Ещё не окончательная чистая прибыль.',
     verifiedIntermediate?'interim':'pending'),
   box('Валовая прибыль · бухгалтерский показатель','Не закрыта',
     'Отчётная сумма продаж не заменяет самостоятельную валовую прибыль','pending'),
   box('Операционная прибыль · после общих затрат','Не закрыта',
     'Общие расходы отражаются один раз в сводном P&L','pending'),
   box('Налог ИП',known?money(ownerAmounts.taxKopecks):'В общей сводке',
     'Учитывается только в общем P&L ИП, а не вычитается из Ozon',
     'separate'),
   box('Общие постоянные расходы',known?money(ownerAmounts.overheadKopecks):
     'В общей сводке','Отдельно на уровне бизнеса, без повторного вычета',
     'separate'),
   box('Итоговая чистая прибыль Ozon','Не подтверждена',
     'Не равна промежуточному результату. Ожидает остальных сверок.',
     'pending')
  ],
  interimKopecks:verifiedIntermediate?a.totalKopecks-cost.knownKopecks:null,
  sourceConfirmed,costConfirmed:verifiedIntermediate,
  finalNetProfitVerified:false
 };
}
if(typeof module!=='undefined'&&module.exports)module.exports={makeOzonCards};
if(typeof window!=='undefined')window.OzonProfitCards={makeOzonCards};
