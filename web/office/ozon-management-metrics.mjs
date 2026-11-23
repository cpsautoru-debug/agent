import {financeRateBps,displayRate,formatFinanceRub,previousMonth,comparativeFinance}
 from './channel-finance-metrics.mjs';
export function ozonManagementMetrics(result,readiness,makeCards){
 const p=makeCards(result,readiness,{
  month:'2026-10',source:'OWNER_STATEMENT_2026-11-23',
  taxKopecks:20550700,overheadKopecks:5400000
 });
 if(!Number.isSafeInteger(p.grossKopecks)||
   !Number.isSafeInteger(p.operatingChannelKopecks)||
   !p.sourceConfirmed||!p.costConfirmed)return null;
 const groups=new Map(result.report.groups.map(x=>[x.name,x.amountKopecks]));
 const basis=(groups.get('Продажи')??0)+(groups.get('Возвраты')??0);
 if(!Number.isSafeInteger(basis)||basis<=0)return null;
 return {month:result.month,basisKopecks:basis,
  grossKopecks:p.grossKopecks,contributionKopecks:p.operatingChannelKopecks,
  grossRateBps:financeRateBps(p.grossKopecks,basis),
  contributionRateBps:financeRateBps(p.operatingChannelKopecks,basis)};
}
export function attachOzonRates({documentRef=document,fetcher=fetch}={}){
 const root=documentRef.getElementById('profitOzonRates');
 const month=documentRef.getElementById('profitMonth');
 if(!root||!month)return false;
 let serial=0;
 async function load(current){
  const id=++serial;
  root.replaceChildren();
  if(!current){root.textContent='Управленческая рентабельность ожидает сверку исходных сумм.';return;}
  const title=documentRef.createElement('h3');title.textContent='Рентабельность Ozon · октябрь и сравнение';
  const p=documentRef.createElement('p');
  p.textContent='Валовая рентабельность: '+displayRate(current.grossRateBps)+
   '; рентабельность после прямых затрат: '+displayRate(current.contributionRateBps)+
   '. База: нетто-начисления группы продаж за вычетом возвратов '+
    formatFinanceRub(current.basisKopecks)+'. Это не рентабельность налоговых доходов.';
  const comparison=documentRef.createElement('p');
  comparison.textContent='Предыдущий месяц: проверяем сопоставимость…';
  root.append(title,p,comparison);
  try{
   const previous=previousMonth(current.month);
   const r=await fetcher('/api/ozon/profit?month='+encodeURIComponent(previous),{
    credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('prior_period_unavailable');
   const data=await r.json();
   const old=ozonManagementMetrics(data.result,data.readiness,
     window.OzonProfitCards.makeOzonCards);
   if(id!==serial||month.value!==current.month)return;
   if(!old||old.month!==previous)throw Error('prior_period_not_reconciled');
   const delta=comparativeFinance(current.contributionKopecks,old.contributionKopecks);
   comparison.textContent='Сравнение с '+previous+': '+formatFinanceRub(old.contributionKopecks)+
     ' → '+formatFinanceRub(current.contributionKopecks)+
     '; изменение '+formatFinanceRub(delta.absoluteKopecks)+
     (delta.changeBps===null?' (процент не определяется)':
      ' ('+displayRate(delta.changeBps)+')')+
     '. Оба месяца рассчитаны по сопоставимым источникам.';
  }catch{
   if(id===serial&&month.value===current.month)
    comparison.textContent='Сравнение с предыдущим месяцем: нет подтверждённого сопоставимого расчёта. Нули и условные проценты не используются.';
  }
 }
 month.addEventListener('change',()=>{serial++;root.textContent='Выберите период и обновите данные.';});
 window.OzonFinanceMetrics={update(result,readiness){
   const current=ozonManagementMetrics(result,readiness,window.OzonProfitCards.makeOzonCards);
   load(current);
 }};
 return true;
}
if(typeof document!=='undefined')attachOzonRates();
