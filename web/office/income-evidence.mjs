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
   !data.wb.operationAmounts||typeof data.wb.operationAmounts!=='object')
   throw Error('income_components_unverified');
 const rub=n=>new Intl.NumberFormat('ru-RU',
    {style:'currency',currency:'RUB'}).format(n/100);
 return 'Ozon XLSX — отдельные статьи (не налоговая база):\n'+
  keys.map(k=>k+': '+rub(services[k].amountKopecks)).join('\n')+
  '\nWildberries: '+data.wb.reports+' финансовых отчётов. Суммы к перечислению не равны выручке до удержаний.'+
  '\nНе подтверждены: доходы ФНС по каналам ИП; юрлица остальных каналов; выручка Авито, Яндекс и офлайна.'+
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
