// Autosklad63 consolidated management P&L: single deduction of shared costs.
// Channel net figures must ALREADY include their direct marketplace fees,
// advertising, manufacturing cost and other direct expenses.
// Owner-selected financial perimeter: marketplace channels only. Avito and
// physical shop are excluded, not assumed to have zero profit.
export const PNL_CHANNELS=['ozon','wb','yandex'];
const valid=x=>Number.isSafeInteger(x);
export function consolidateBusinessPnl({month,channels,sharedExpenses,taxes,
 completeSources=false,sharedExpensesComplete=false,taxesComplete=false}){
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
     (type==='tax'&&x.entity!=='ip'))
     throw Error('pnl_expense_invalid');
   seen.add(x.id);
   return {...x,kind:type};
 }
 const expenses=[...sharedExpenses.map(x=>checkExpense(x,'shared')),
  ...taxes.map(x=>checkExpense(x,'tax'))];
 const missing=entries.filter(x=>x.status==='unknown').map(x=>x.id);
 const confirmed=completeSources===true&&sharedExpensesComplete===true&&
   taxesComplete===true&&missing.length===0&&
   entries.every(x=>x.status==='verified');
 const allPresent=missing.length===0;
 const moneySum=arr=>arr.reduce((n,x)=>{
   const next=n+x;
   if(!valid(next))throw Error('pnl_overflow');
   return next;
 },0);
 const knownEntries=entries.filter(x=>x.status!=='unknown');
 const knownChannelsTotal=knownEntries.length?
   moneySum(knownEntries.map(x=>x.profitKopecks)):null;
  const channelsTotal=allPresent?moneySum(entries.map(x=>x.profitKopecks)):null;
 const sharedTotal=sharedExpenses.length?
   moneySum(sharedExpenses.map(x=>x.amountKopecks)):null;
 const taxTotal=taxes.length?
   moneySum(taxes.map(x=>x.amountKopecks)):null;
 // The provisional number may be shown if all three channels have
 // independently reviewed direct-cost results, even when shared expenses
 // and IP tax have not been certified as exhaustive. Never label it net.
 const provisionalAfterExpenses=channelsTotal!==null&&
  sharedTotal!==null&&taxTotal!==null?
   moneySum([channelsTotal,-sharedTotal,-taxTotal]):null;
 // Net profit is claimable only with fully certified three-channel results
 // AND exhaustive, non-duplicated shared/tax records.
 const after=confirmed?provisionalAfterExpenses:null;
 // Arithmetic over visible known rows ONLY. Shared expenses and the
 // whole-IP tax are not attributable to just these channels; the resulting
 // number is neither channel profit nor the business net profit.
 const visibleRowsRemainder=knownChannelsTotal!==null&&
  sharedTotal!==null&&taxTotal!==null?
   moneySum([knownChannelsTotal,-sharedTotal,-taxTotal]):null;
 return {month,channels:entries,sharedExpenses, taxes,
   status:confirmed?'verified':
    provisionalAfterExpenses!==null?'management_estimate':'incomplete',
   sharedExpensesComplete,taxesComplete,
   missingChannels:missing,channelsTotalKopecks:channelsTotal,
   knownChannelsTotalKopecks:knownChannelsTotal,
   visibleRowsRemainderKopecks:visibleRowsRemainder,
   visibleRowsRemainderIsProfit:false,
   provisionalAfterExpensesKopecks:provisionalAfterExpenses,
   provisionalAfterExpensesIsNetProfit:false,
   knownChannelCount:knownEntries.length,
   sharedExpenseTotalKopecks:sharedTotal,taxTotalKopecks:taxTotal,
   finalProfitKopecks:after,verified:confirmed,
   note:'Only Ozon, WB and Yandex direct-cost results enter the total; Avito and offline are excluded. Shared expenses and total IP tax are each deducted once. Provisional results never imply certified net profit.'};
}
