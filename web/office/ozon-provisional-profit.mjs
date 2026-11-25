// Read-only provisional management P&L. It is not a tax register or an audit.
// Only use source facts that have an independent day-total parity check.
export function summarizeOzonProvisionalProfit(month,data){
 const result=data?.result,ready=data?.readiness;
 if(!result||!ready||result.month!==month||ready.month!==month||
    ready.netProfitVerified!==false)throw Error('invalid_profit_source');
 // This is a *known-cost contribution*, not the accountant's closeout.
 // Closing checks (bank, tax, advertising detail, overhead allocation) must
 // not hide a source-reconciled intermediate contribution margin.
 const d=ready.dailyParity,c=result.costs,dated=result.dateCostEvidence;
 const blockers=[];
 const require=(check,reason)=>{if(!check)blockers.push(reason);};
 require(ready.report?.complete===true,'xlsx_report_not_complete');
 require(ready.sourcesMatch?.apiVsXlsxKopecks===true,
   'finance_api_and_xlsx_totals_not_matched');
 require(d?.code==='ozon_daily_totals_parity'&&d?.match===true&&
   d?.readOnly===true&&d?.changedRecords===0&&
   Number.isSafeInteger(d?.expectedDays)&&d.expectedDays>0&&
   d?.checkedDays===d?.expectedDays,'daily_totals_not_reconciled');
 require(c?.complete===true&&ready.cogs?.complete===true,
   'manufacturing_costs_not_complete');
 require(dated?.complete===true&&dated?.checkedSalesRows>0&&
   dated.checkedSalesRows===dated.confirmedSalesRows&&
   ready.cogs?.checkedSalesRows===dated?.checkedSalesRows&&
   ready.cogs?.confirmedSalesRows===dated?.confirmedSalesRows,
   'dated_sales_costs_not_confirmed');
 const profitBlockers=result.profit?.blockers;
 // Identical charge rows in the official XLSX can be legitimate separate
 // fees. They are *candidates*, not proven duplicates. Daily API parity
 // covers their aggregate, but the detailed transactions remain unverified.
 // A duplicate candidate involving SALE or RETURN still blocks COGS.
 const candidateGroups=result.duplicateCandidates;
 const rawLines=data?.configuration?.month?.rows;
 const bySourceRow=Array.isArray(rawLines)?
   new Map(rawLines.map(x=>[x.row,x])):null;
 const duplicateGroupsSafe=Array.isArray(candidateGroups)&&
   candidateGroups.every(group=>Array.isArray(group)&&group.length>1&&
     group.every(row=>{
       const line=bySourceRow?.get(row);
       return Number.isSafeInteger(row)&&!!line&&
         line.service!=='Выручка'&&line.service!=='Возврат выручки';
     }));
 const blockingCodes=[
   'return_recovery_unverified','unknown_services',
   'sku_missing','cost_missing','cost_preliminary','quantity_missing',
   'report_api_mismatch','quantity_unverified','period_unverified'
 ];
 const unsafeBlockers=Array.isArray(profitBlockers)?
   profitBlockers.filter(x=>blockingCodes.includes(x)||
     (x==='duplicate_candidates'&&!duplicateGroupsSafe)):[];
 require(Array.isArray(profitBlockers)&&unsafeBlockers.length===0,
   'unresolved_source_or_cost_blockers'+
   (unsafeBlockers.length?': '+unsafeBlockers.join(', '):''));

 const net=result.api?.totalKopecks,cogs=c?.knownKopecks;
 require(Number.isSafeInteger(net)&&net===ready.accruals?.totalKop&&
   net===ready.report?.controlTotalKop,
   'source_net_amount_not_confirmed');
 require(Number.isSafeInteger(cogs)&&cogs>=0&&
   Number.isSafeInteger(net-cogs),'cogs_amount_not_confirmed');
 const valid=blockers.length===0;
 // Only totals present in the current canonical Ozon Profit documents
 // may appear in the review. Never hardcode a taxpayer's tax register.
 const currentExpenses=data?.configuration?.expenses;
 const overheadRows=Array.isArray(currentExpenses?.items)?
  currentExpenses.items.filter(x=>x.scope==='business'&&
   typeof x.validFrom==='string'&&x.validFrom<month+'-32'&&
   (x.validTo===null||x.validTo>=month+'-01')):null;
 const overheadTotal=overheadRows&&overheadRows.every(x=>
  Number.isSafeInteger(x.amountKopecks)&&x.amountKopecks>=0)?
  overheadRows.reduce((sum,x)=>sum+x.amountKopecks,0):null;
 const taxDoc=data?.configuration?.tax;
 const taxTotal=taxDoc?.complete===true&&
  Array.isArray(taxDoc.events)&&taxDoc.events.length>0?
  null:null; // Tax amount is not an audited FNS payment or allocated share.
 return {
  month,source:'OZON_XLSX_API_DAY_PARITY_AND_DATE_COGS',
  status:valid?'provisional_known_cost_result':'insufficient_evidence',
  missingEvidence:blockers,
  reviewWarnings:valid&&profitBlockers?.includes('duplicate_candidates')?
    ['identical_non_sale_fee_rows_require_detail_review']:[],
  financeNetKopecks:valid?net:null,
  netManufacturingCostKopecks:valid?cogs:null,
  beforeAllocationKopecks:valid?net-cogs:null,
  ownerTaxTotalKopecks:taxTotal,
  businessOverheadTotalKopecks:Number.isSafeInteger(overheadTotal)?overheadTotal:null,
  ozonTaxAllocationKopecks:null,ozonOverheadAllocationKopecks:null,
  netProfitKopecks:null,verifiedNetProfit:false,
  warning:'Source amounts and manufacturing cost do not establish audited tax, bank settlement, or channel allocation.'
 };
}
export function describeOzonProvisionalProfit(s){
 if(!s||s.verifiedNetProfit!==false||s.netProfitKopecks!==null)
  throw Error('invalid_provisional_result');
 const rub=n=>Number.isSafeInteger(n)?
  new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100):
  'не подтверждено';
 if(s.status!=='provisional_known_cost_result')
   return 'Промежуточный результат недоступен: '+
     (Array.isArray(s.missingEvidence)?s.missingEvidence.join(', '):
       'недостаточно подтверждённых источников')+
     '. Чистая прибыль не подтверждена.';
 return 'Октябрь Ozon — расчёт по известным затратам (НЕ чистая прибыль):\\n'+
  'Сальдо Ozon после удержаний: '+rub(s.financeNetKopecks)+'\\n'+
  'Себестоимость с возвратами: −'+rub(s.netManufacturingCostKopecks)+'\\n'+
  'Промежуточный результат: '+rub(s.beforeAllocationKopecks)+'\\n'+
  'Налог ИП в целом: '+rub(s.ownerTaxTotalKopecks)+'; доля Ozon неизвестна.\\n'+
  'Общие расходы по регистру (не подтверждение оплаты): '+rub(s.businessOverheadTotalKopecks)+'; доля Ozon неизвестна.\\n'+
  'Чистая прибыль Ozon: НЕ РАССЧИТАНА. Это не нижняя или верхняя граница прибыли.';
}
export function attachOzonProvisionalProfit({documentRef=document,fetcher=fetch}={}){
 const button=documentRef.getElementById('profitProvisionalRefresh');
 const text=documentRef.getElementById('profitProvisionalStatus');
 const monthInput=documentRef.getElementById('profitMonth');
 if(!button||!text||!monthInput)return false;
 let generation=0;
 const load=async()=>{
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
 };
 button.addEventListener('click',load);
 let autoLoaded='';
 const auto=()=>{
  if(typeof window==='undefined'||window.location.hash.split('/')[0]!=='#ozonProfit')return;
  if(monthInput.value==='2026-10'&&autoLoaded!==monthInput.value){
   autoLoaded=monthInput.value;void load();
  }
 };
 if(typeof window!=='undefined'){
  window.addEventListener('hashchange',auto);
  // The month input is populated by the existing finance UI during init.
  queueMicrotask(auto);
 }
 monthInput.addEventListener('change',()=>{
  generation++;autoLoaded='';text.textContent='Выбран новый месяц. Сверка доступна после появления официальных документов.';
  button.disabled=false;auto();
 });
 return true;
}
if(typeof document!=='undefined')attachOzonProvisionalProfit();
