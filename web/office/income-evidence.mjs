// Diagnostic only: source totals from Ozon and WB are not tax bases.
export function describeIncomeEvidence(data,month){
 if(data?.code!=='entity_income_evidence'||data.month!==month||
    data.readOnly!==true||data.changedRecords!==0||
    data.distributionReady!==false||data.fnsRegisterReconciled!==false||
    data.ozon?.taxIncomeConfirmed!==false||
    data.wb?.taxIncomeConfirmed!==false)
   throw Error('income_source_unverified');
 const services=data.ozon.serviceAmounts;
 const keys=['Выручка','Возврат выручки','Баллы за скидки','Программы партнёров'];
 if(!services||keys.some(k=>!Number.isSafeInteger(services[k]?.amountKopecks)||
   !Number.isSafeInteger(services[k]?.rows))||
   !Number.isSafeInteger(data.wb.reports)||
   !data.wb.operationAmounts||typeof data.wb.operationAmounts!=='object'||
   (data.wb.costCoverage!==null&&data.wb.costCoverage!==undefined&&
    (!Number.isSafeInteger(data.wb.costCoverage.soldArticles)||
     !Number.isSafeInteger(data.wb.costCoverage.confirmedArticles)||
     !Number.isSafeInteger(data.wb.costCoverage.preliminaryArticles)||
     data.wb.costCoverage.complete!==false))||
      data.ozon.nonAdditiveTotals!==true||
   typeof data.ozon.taxDocumentPresent!=='boolean'||
   typeof data.wb.reportPeriodComplete!=='boolean'||
   !Array.isArray(data.wb.reportTypeCoverage)||
   data.wb.reportTypeCoverage.some(x=>
     !Number.isSafeInteger(x.reportType)||
     !Number.isSafeInteger(x.coveredDays)||
     !Number.isSafeInteger(x.expectedDays)||
     !Array.isArray(x.missingDates)||
     !Number.isSafeInteger(x.overlappingDays)||
     typeof x.periodComplete!=='boolean')||
   data.ozon.classification?.discountPoints?.status!==
     'marketplace_bonus_not_separate_sales_revenue')
   throw Error('income_components_unverified');
 const review=data.wb.costReview;
 if(review!==null&&review!==undefined&&
   (!Array.isArray(review)||review.length>40||
    review.some(r=>typeof r.vendorCode!=='string'||
      !Number.isSafeInteger(r.soldUnits)||
      !Number.isSafeInteger(r.saleRows)||
      !['confirmed','preliminary','missing'].includes(r.costStatus)||
      r.candidateOzonSku!==null||
      typeof r.requiresPhysicalConfirmation!=='boolean')))
   throw Error('invalid_wb_cost_review');
  const rub=n=>new Intl.NumberFormat('ru-RU',
    {style:'currency',currency:'RUB'}).format(n/100);
 return 'Ozon XLSX — отдельные статьи (не налоговая база):\n'+
  keys.map(k=>k+': '+rub(services[k].amountKopecks)).join('\n')+
  '\nВажно: «Баллы за скидки» не прибавляются второй раз к выручке; суммы по статьям разного экономического смысла не суммируются.'+
  '\nВыручка XLSX — начисление, а не подтверждённый доход АУСН за календарный месяц.'+
  '\nWildberries: '+data.wb.reports+' финансовых отчётов. Суммы к перечислению не равны выручке до удержаний.'+
  '\nПриоритет проверки WB (больше всего продаж, только артикулы):\n'+
    (review?.length?review.slice(0,12).map((r,i)=>
      (i+1)+'. '+r.vendorCode+' — '+r.soldUnits+' шт.; себестоимость: '+
      ({confirmed:'подтверждена',preliminary:'предварительная',missing:'нет'}[r.costStatus])
    ).join('\n'):'список не получен')+
  '\nWB — себестоимость: '+
    (data.wb.costCoverage?
      data.wb.costCoverage.confirmedArticles+' из '+
      data.wb.costCoverage.soldArticles+
      ' проданных артикулов имеют подтверждённую запись себестоимости; '+
      data.wb.costCoverage.preliminaryArticles+' — предварительную. '+
      'Это проверка на интервал отчёта, а не на точную дату продажи.':
      'проверка источника недоступна.')+
  '\nWB: покрытие отчётных периодов — '+(data.wb.reportPeriodComplete?
    'полный месяц по каждому типу отчёта':
    'есть пропущенные или пересекающиеся периоды')+
    '; это не проверка налоговой выручки.'+
  '\nOzon: налоговый документ за месяц — '+
    (data.ozon.taxDocumentPresent?'есть, необходима проверка':'отсутствует')+'.'+
  '\nНе хватает для распределения налога: подтверждённых доходов АУСН по каналам ИП, реестра взаимозачётов и проверки принадлежности каналов этому ИП.'+
  '\nНе хватает для распределения 54 000 ₽: выручки Авито, Яндекс Маркета и офлайна, а также подтверждённой сопоставимой выручки Ozon/WB.'+
  '\nРаспределение налога и расходов пока невозможно.';
}
export function attachIncomeEvidence({documentRef=document,fetcher=fetch}={}){
 const node=documentRef.getElementById('profitIncomeEvidence');
 const monthInput=documentRef.getElementById('profitMonth');
 const button=documentRef.getElementById('profitIncomeEvidenceRefresh');
 if(!node||!monthInput||!button)return false;
 let counter=0;
 async function refresh(){
  const requestNumber=++counter,month=monthInput.value;
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){
   node.textContent='Выберите отчётный месяц.';return;
  }
  node.textContent='Проверяем источники доходов...';
  button.disabled=true;
  try{
   const res=await fetcher('/api/finance/income-evidence?month='+encodeURIComponent(month),{
    method:'GET',credentials:'same-origin',cache:'no-store',
    signal:AbortSignal.timeout(20000)
   });
   if(!res.ok)throw Error('source_unavailable');
   const data=await res.json();
   if(monthInput.value===month&&counter===requestNumber)
    node.textContent=describeIncomeEvidence(data,month);
  }catch{
   if(monthInput.value===month&&counter===requestNumber)
    node.textContent='Сверка доходов недоступна. Не считать отсутствующие доходы нулевыми.';
  }finally{if(counter===requestNumber)button.disabled=false;}
 }
 button.addEventListener('click',refresh);
 monthInput.addEventListener('change',()=>{
  counter++;node.textContent='Проверка доходов для нового месяца ещё не выполнена.';
 });
 return true;
}
if(typeof document!=='undefined')attachIncomeEvidence();
