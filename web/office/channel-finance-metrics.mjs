// Strict P&L ratios and month-over-month change: unavailable periods never become zero.
export const formatFinanceRub=kopecks=>Number.isSafeInteger(kopecks)?
 new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(kopecks/100):
 'Нет подтверждённой суммы';
export function financeRateBps(numerator,denominator){
 if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator)||
   denominator<=0)return null;
 const n=Math.round(numerator/denominator*10000);
 return Number.isSafeInteger(n)?n:null;
}
export function displayRate(bps){
 return Number.isSafeInteger(bps)?
   (bps/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+'%':
   'Нет сопоставимой базы';
}
export function previousMonth(month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('bad_month');
 const d=new Date(month+'-01T00:00:00Z');
 d.setUTCMonth(d.getUTCMonth()-1);
 return d.toISOString().slice(0,7);
}
export function comparativeFinance(current,previous){
 if(!Number.isSafeInteger(current)||!Number.isSafeInteger(previous))
   return {status:'insufficient_data',absoluteKopecks:null,changeBps:null};
 const change=current-previous;
 if(!Number.isSafeInteger(change))throw Error('unsafe_finance_delta');
 return {status:'comparable',absoluteKopecks:change,
   changeBps:previous===0?null:financeRateBps(change,Math.abs(previous))};
}
