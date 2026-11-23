// Read-only provisional management P&L. It is not a tax register or an audit.
// Only use source facts that have an independent day-total parity check.
export function summarizeOzonProvisionalProfit(month,data){
 const result=data?.result,ready=data?.readiness;
 if(!result||!ready||result.month!==month||ready.month!==month||
    ready.netProfitVerified!==false)throw Error('invalid_profit_source');
 const d=ready.dailyParity,c=result.costs,dated=result.dateCostEvidence;
 const ok=ready.report?.complete===true&&
   ready.sourcesMatch?.apiVsXlsxKopecks===true&&
   d?.match===true&&d?.checkedDays===d?.expectedDays&&
   c?.complete===true&&dated?.complete===true&&
   dated.checkedSalesRows>0&&
   dated.checkedSalesRows===dated.confirmedSalesRows&&
   result.financeCloseout?.netProfitVerified===false&&
   result.financeCloseout?.status==='not_verified'&&
   Array.isArray(result.profit?.blockers)&&
   !result.profit.blockers.includes('return_recovery_unverified')&&
   !result.profit.blockers.includes('unknown_services')&&
   !result.profit.blockers.includes('duplicate_candidates');
 const net=result.api?.totalKopecks,cogs=c?.knownKopecks;
 const valid=ok&&Number.isSafeInteger(net)&&Number.isSafeInteger(cogs)&&
   cogs>=0&&Number.isSafeInteger(net-cogs);
 return {
  month,source:'OZON_XLSX_API_DAY_PARITY_AND_DATE_COGS',
  status:valid?'provisional_known_cost_result':'insufficient_evidence',
  financeNetKopecks:valid?net:null,
  netManufacturingCostKopecks:valid?cogs:null,
  beforeAllocationKopecks:valid?net-cogs:null,
  ownerTaxTotalKopecks:month==='2026-10'?20550700:null,
  businessOverheadTotalKopecks:month==='2026-10'?5400000:null,
  ozonTaxAllocationKopecks:null,ozonOverheadAllocationKopecks:null,
  netProfitKopecks:null,verifiedNetProfit:false,
  warning:'Source amounts and manufacturing cost do not establish audited tax, bank settlement, or channel allocation.'
 };
}
export function describeOzonProvisionalProfit(s){
 if(!s||s.verifiedNetProfit!==false||s.netProfitKopecks!==null)
  throw Error('invalid_provisional_result');
 const rub=n=>new Intl.NumberFormat('ru-RU',
   {style:'currency',currency:'RUB'}).format(n/100);
 if(s.status!=='provisional_known_cost_result')
   return 'Расчёт по известным затратам недоступен: необходимы полный отчёт, совпадение ежедневных сумм API/XLSX и себестоимость всех продаж. Чистая прибыль не подтверждена.';
 return 'Октябрь Ozon — расчёт по известным затратам (НЕ чистая прибыль):\\n'+
  'Сальдо Ozon после удержаний: '+rub(s.financeNetKopecks)+'\\n'+
  'Себестоимость с возвратами: −'+rub(s.netManufacturingCostKopecks)+'\\n'+
  'Промежуточный результат: '+rub(s.beforeAllocationKopecks)+'\\n'+
  'Налог ИП в целом: '+rub(s.ownerTaxTotalKopecks)+'; доля Ozon неизвестна.\\n'+
  'Общие расходы бизнеса: '+rub(s.businessOverheadTotalKopecks)+'; доля Ozon неизвестна.\\n'+
  'Чистая прибыль Ozon: НЕ РАССЧИТАНА. Это не нижняя или верхняя граница прибыли.';
}
export function attachOzonProvisionalProfit({documentRef=document,fetcher=fetch}={}){
 const button=documentRef.getElementById('profitProvisionalRefresh');
 const text=documentRef.getElementById('profitProvisionalStatus');
 const monthInput=documentRef.getElementById('profitMonth');
 if(!button||!text||!monthInput)return false;
 let generation=0;
 button.addEventListener('click',async()=>{
  const thisRun=++generation,month=monthInput.value;
  if(month!=='2026-10'){
   text.textContent='Проверенный расчёт по исходным документам пока доступен только за октябрь 2026.';
   return;
  }
  button.disabled=true;
  text.textContent='Проверяем дневную сверку и себестоимость...';
  try{
   const response=await fetcher('/api/ozon/profit?month='+encodeURIComponent(month),{
    method:'GET',credentials:'same-origin',cache:'no-store',
    signal:AbortSignal.timeout(20000)
   });
   if(!response.ok)throw Error('source_unavailable');
   const data=await response.json();
   const summary=summarizeOzonProvisionalProfit(month,data);
   if(generation===thisRun&&monthInput.value===month)
    text.textContent=describeOzonProvisionalProfit(summary);
  }catch{
   if(generation===thisRun&&monthInput.value===month)
    text.textContent='Пока не удалось подтвердить промежуточный расчёт. Не считайте отсутствие данных нулём.';
  }finally{if(generation===thisRun)button.disabled=false;}
 });
 monthInput.addEventListener('change',()=>{
  generation++;text.textContent='Новый месяц не проверен. Нажмите кнопку для сверки.';
  button.disabled=false;
 });
 return true;
}
if(typeof document!=='undefined')attachOzonProvisionalProfit();
