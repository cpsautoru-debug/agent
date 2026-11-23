// Autosklad63 consolidated management P&L: single deduction of shared costs.
// Channel net figures must ALREADY include their direct marketplace fees,
// advertising, manufacturing cost and other direct expenses.
export const PNL_CHANNELS=['ozon','wb','yandex','avito','offline'];
const valid=x=>Number.isSafeInteger(x);
export function consolidateBusinessPnl({month,channels,sharedExpenses,taxes,
 completeSources=false}){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||'')||
   !channels||!Array.isArray(sharedExpenses)||!Array.isArray(taxes))
   throw Error('pnl_input_invalid');
 const entries=PNL_CHANNELS.map(id=>{
   const x=channels[id]||{status:'unknown',profitKopecks:null};
   if(!['known_cost_result','verified','unknown'].includes(x.status)||
     (x.status==='unknown'&&x.profitKopecks!==null)||
     (x.status!=='unknown'&&!valid(x.profitKopecks)))
     throw Error('pnl_channel_invalid');
   return {id,status:x.status,profitKopecks:x.profitKopecks};
 });
 const seen=new Set();
 function checkExpense(x,type){
   if(typeof x.id!=='string'||!x.id||seen.has(x.id)||!valid(x.amountKopecks)||
     x.amountKopecks<0||
     (type==='tax'&&!['ip','ooo'].includes(x.entity)))
     throw Error('pnl_expense_invalid');
   seen.add(x.id);
   return {...x,kind:type};
 }
 const expenses=[...sharedExpenses.map(x=>checkExpense(x,'shared')),
  ...taxes.map(x=>checkExpense(x,'tax'))];
 const missing=entries.filter(x=>x.status==='unknown').map(x=>x.id);
 const confirmed=completeSources===true&&missing.length===0&&
   entries.every(x=>x.status==='verified');
 const allPresent=missing.length===0;
 const moneySum=arr=>arr.reduce((n,x)=>{
   const next=n+x;
   if(!valid(next))throw Error('pnl_overflow');
   return next;
 },0);
 const channelsTotal=allPresent?moneySum(entries.map(x=>x.profitKopecks)):null;
 const sharedTotal=moneySum(sharedExpenses.map(x=>x.amountKopecks));
 const taxTotal=moneySum(taxes.map(x=>x.amountKopecks));
 const after=channelsTotal===null?null:
   moneySum([channelsTotal,-sharedTotal,-taxTotal]);
 return {month,channels:entries,sharedExpenses, taxes,
   status:confirmed?'verified':allPresent?'management_estimate':'incomplete',
   missingChannels:missing,channelsTotalKopecks:channelsTotal,
   sharedExpenseTotalKopecks:sharedTotal,taxTotalKopecks:taxTotal,
   finalProfitKopecks:after,verified:confirmed,
   note:'Only direct-cost channel profit enters the total. Shared expenses and taxes are deducted once.'};
}
