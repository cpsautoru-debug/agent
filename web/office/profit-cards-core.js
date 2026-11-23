// Owner-facing management P&L, built only from reconciled Ozon source rows.
// Separate from statutory accounting and from consolidated IP/company taxes.
function makeOzonCards(result,readiness,ownerAmounts){
 const ok=Number.isSafeInteger;
 const r=result||{},a=r.api||{},report=r.report||{},cost=r.costs||{},
   dated=r.dateCostEvidence||{},rr=readiness||{};
 const month=r.month;
 const money=n=>ok(n)?new Intl.NumberFormat('ru-RU',
   {style:'currency',currency:'RUB'}).format(n/100):'Нет подтверждённой суммы';
 const box=(label,amount,detail,kind='normal')=>({
   label,value:ok(amount)?money(amount):String(amount),detail,kind
 });
 const sourceConfirmed=rr.month===month&&rr.code==='ozon_finance_readiness'&&
   rr.sourcesMatch?.apiVsXlsxKopecks===true&&
   rr.dailyParity?.code==='ozon_daily_totals_parity'&&
   rr.dailyParity?.readOnly===true&&rr.dailyParity?.changedRecords===0&&
   rr.dailyParity?.match===true&&
   rr.dailyParity?.checkedDays===rr.dailyParity?.expectedDays&&
   rr.dailyParity?.expectedDays>0&&rr.report?.complete===true&&
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
 const blockers=Array.isArray(r.profit?.blockers)?r.profit.blockers:null;
 const costBlockers=blockers===null||unsafe.some(x=>blockers.includes(x));
 const safeSum=values=>{
   let total=0;
   for(const val of values){
     if(!ok(val)||!ok(total+val))return null;
     total+=val;
   }
   return total;
 };
 const groups=Array.isArray(report.groups)?report.groups:null;
 const allowedGroups=[
   'Продажи','Возвраты','Вознаграждение Ozon','Услуги доставки',
   'Продвижение и реклама','Услуги партнёров','Услуги FBO',
   'Озон Технологии','Другие услуги и штрафы'
 ];
 const grouped=new Map();
 let groupValid=!!groups;
 if(groupValid){
   for(const entry of groups){
     if(!allowedGroups.includes(entry?.name)||!ok(entry.amountKopecks)||
       grouped.has(entry.name)){groupValid=false;break;}
     grouped.set(entry.name,entry.amountKopecks);
   }
 }
 const sale=grouped.get('Продажи'),returns=grouped.get('Возвраты');
 const groupTotal=groupValid?safeSum([...grouped.values()]):null;
 const groupReconciled=sourceConfirmed&&groupValid&&grouped.has('Продажи')&&
   grouped.has('Возвраты')&&sale===report.salesKopecks&&
   returns===report.returnsKopecks&&groupTotal===a.totalKopecks&&
   sale>=0&&returns<=0&&
   [...grouped].every(([name,value])=>
     name==='Продажи'||name==='Возвраты'||value<=0);
 const verifiedIntermediate=groupReconciled&&costConfirmed&&!costBlockers&&
   ok(a.totalKopecks-cost.knownKopecks);
 const netSales=verifiedIntermediate?safeSum([sale,returns]):null;
 const gross=verifiedIntermediate?safeSum([netSales,-cost.knownKopecks]):null;
 const feeGroups=[
   ['Комиссия Ozon','Вознаграждение Ozon'],
   ['Доставка и логистика','Услуги доставки'],
   ['Реклама и продвижение','Продвижение и реклама'],
   ['Услуги партнёров','Услуги партнёров'],
   ['Услуги FBO','Услуги FBO'],
   ['Услуги Ozon Технологии','Озон Технологии'],
   ['Другие услуги и штрафы','Другие услуги и штрафы']
 ];
 const feeRows=feeGroups.map(([label,key])=>({
   label,key,amountKopecks:verifiedIntermediate?
     (grouped.get(key)??0):null
 }));
 const totalFees=verifiedIntermediate?
   safeSum(feeRows.map(x=>x.amountKopecks)):null;
 const contribution=verifiedIntermediate?
   safeSum([gross,totalFees]):null;
 const balanced=verifiedIntermediate&&ok(netSales)&&ok(gross)&&
   ok(totalFees)&&contribution===a.totalKopecks-cost.knownKopecks;
 const valid=!!balanced;
 const stated=month==='2026-10'&&ownerAmounts&&
   ownerAmounts.month==='2026-10'&&
   ownerAmounts.source==='OWNER_STATEMENT_2026-11-23'&&
   ownerAmounts.taxKopecks===20550700&&
   ownerAmounts.overheadKopecks===5400000;
 const amount=(n,ready)=>ready?n:'Требуется сверка';
 const cards=[
   box('Начисления · продажи Ozon',amount(sale,valid),
     'Группа «Продажи» в XLSX, включая скидочные начисления'),
   box('Начисления · возвраты',amount(returns,valid),
     'Группа «Возвраты»; уже учтена в нетто'),
   box('Нетто-начисления до услуг Ozon',amount(netSales,valid),
     'Продажи за вычетом возвратов, до комиссий и услуг'),
   box('Себестоимость с возвратами',amount(cost.knownKopecks,valid),
     'Подтверждённая себестоимость на дату продажи с возвратами'),
   box('Валовая прибыль · управленческий P&L',amount(gross,valid),
     'Нетто-начисления минус производственная себестоимость','interim'),
   ...feeRows.map(({label,amountKopecks})=>
     box(label,amount(amountKopecks,valid),
       'Уже включено в сальдо API Ozon — не списывать дважды')),
   box('Всего удержаний и услуг Ozon',amount(totalFees,valid),
     'Сумма семи групп услуг; реклама уже включена'),
   box('Операционный результат Ozon · до общих расходов',
     amount(contribution,valid),
     'Сальдо Ozon минус себестоимость. До общих затрат и налога ИП.',
     'interim'),
   box('Общие постоянные расходы бизнеса',
     stated?ownerAmounts.overheadKopecks:'Нет подтверждённой суммы',
     'Отдельно в сводном P&L бизнеса, не расход только Ozon','separate'),
   box('Налог ИП за октябрь',
     stated?ownerAmounts.taxKopecks:'Нет подтверждённой суммы',
     'Учитывается один раз в сводном P&L ИП, не вычитается из Ozon','separate'),
   box('Чистая прибыль всего бизнеса','Ожидает закрытия',
     'Не хватает итогов остальных каналов и полного перечня общих расходов и налогов','pending')
 ];
 return {cards,sourceConfirmed:groupReconciled,costConfirmed:valid,
   grossKopecks:valid?gross:null,
   operatingChannelKopecks:valid?contribution:null,
   interimKopecks:valid?contribution:null,
   netProfitKopecks:null,finalNetProfitVerified:false,
   warning:valid?'Управленческий расчёт из сверенного XLSX и COGS; не бухгалтерская отчётность.':
     'Требуется сверка групп начислений, API и себестоимости.'};
}
if(typeof module!=='undefined'&&module.exports)module.exports={makeOzonCards};
if(typeof window!=='undefined')window.OzonProfitCards={makeOzonCards};
