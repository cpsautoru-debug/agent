import {allocateEntityTotal} from './entity-allocation.mjs';

// October 2026 figures were supplied by the owner; not independently
// verified against a FNS source document. Never report an audited tax.
export const OCTOBER_OWNER_DECISIONS=Object.freeze({
 month:'2026-10',taxKopecks:20550700,overheadKopecks:5400000,
 taxBasis:'ENTITY_TAX_INCOME',overheadBasis:'ALL_CHANNEL_REVENUE',
 source:'OWNER_STATEMENT_2026-11-23',
 taxEntity:'IP_AUSN_8_PERCENT'
});
export function summarizeOctoberAllocation({taxIncome=null,revenue=null,
 ipChannels=null,allChannels=null}={}){
 const decision=OCTOBER_OWNER_DECISIONS;
 const tax=taxIncome&&ipChannels?
  allocateEntityTotal({totalKopecks:decision.taxKopecks,
    amounts:taxIncome,eligibleChannels:ipChannels,
    source:decision.source}):null;
 const overhead=revenue&&allChannels?
  allocateEntityTotal({totalKopecks:decision.overheadKopecks,
    amounts:revenue,eligibleChannels:allChannels,
    source:decision.source}):null;
 return {month:decision.month,taxEntity:decision.taxEntity,
  taxKopecks:decision.taxKopecks,overheadKopecks:decision.overheadKopecks,
  taxAllocation:tax,overheadAllocation:overhead,
  taxVerifiedByFNS:false,
  verifiedNetProfit:false,
  source:decision.source};
}
const RUB=n=>new Intl.NumberFormat('ru-RU',
 {style:'currency',currency:'RUB'}).format(n/100);
export function describeOctoberAllocation(summary){
 if(!summary||summary.month!=='2026-10')throw Error('invalid_owner_decisions');
 const tax=summary.taxAllocation;
 const overhead=summary.overheadAllocation;
 return 'Налог ИП (сумма сообщена владельцем, ФНС не сверена): '+
  RUB(summary.taxKopecks)+'. Общие расходы: '+
  RUB(summary.overheadKopecks)+' в месяц. '+
  'Налог Ozon: '+(tax?.status==='allocated_management_only'?
    RUB(tax.allocations.ozon):
    'доля не рассчитана: нет полного реестра налоговых доходов этого ИП')+
  '. Доля общих расходов Ozon: '+
  (overhead?.status==='allocated_management_only'?
    RUB(overhead.allocations.ozon):
    'не рассчитана: нет подтверждённой выручки всех каналов')+
  '. Выручку нельзя заменять суммами выплат Ozon/WB или нулями.'+
  ' Чистая прибыль остаётся неподтверждённой.';
}
export function attachOctoberAllocation({documentRef=document}={}){
 const node=documentRef.getElementById('profitOwnerAllocation');
 const month=documentRef.getElementById('profitMonth');
 if(!node||!month)return false;
 const refresh=()=>{
   node.textContent=month.value==='2026-10'?
    describeOctoberAllocation(summarizeOctoberAllocation()):
    'Для выбранного месяца нет подтверждённого полного реестра доходов и решения по налогу. Распределение не выполняется.';
 };
 month.addEventListener('change',refresh);
 refresh();
 return true;
}
if(typeof document!=='undefined')attachOctoberAllocation();
