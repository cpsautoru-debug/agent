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
 // Tax belongs to the IP's consolidated P&L only.
 // Never allocate its charge to individual marketplace cards.
 const tax=null;
 const overhead=revenue&&allChannels?
  allocateEntityTotal({totalKopecks:decision.overheadKopecks,
    amounts:revenue,eligibleChannels:allChannels,
    source:decision.source}):null;
 return {month:decision.month,taxEntity:decision.taxEntity,
  taxKopecks:decision.taxKopecks,overheadKopecks:decision.overheadKopecks,
  taxAllocation:tax,overheadAllocation:overhead,
  taxAccountingMode:'entity_only_no_channel_allocation',
  taxVerifiedByFNS:false,
  verifiedNetProfit:false,
  source:decision.source};
}

/** Entity-only consolidated tax deduction; no guessed channel totals. */
export function consolidatedIpAfterTax({profitBeforeTaxKopecks=null,
 allIpChannelsComplete=false,taxKopecks=OCTOBER_OWNER_DECISIONS.taxKopecks}={}){
 if(!Number.isSafeInteger(taxKopecks)||taxKopecks<0)
   throw Error('invalid_entity_tax');
 if(allIpChannelsComplete!==true||
   !Number.isSafeInteger(profitBeforeTaxKopecks))
   return {status:'incomplete',profitBeforeTaxKopecks:null,
     taxKopecks,profitAfterTaxKopecks:null,scope:'IP_ONLY'};
 const profitAfterTaxKopecks=profitBeforeTaxKopecks-taxKopecks;
 if(!Number.isSafeInteger(profitAfterTaxKopecks))throw Error('unsafe_entity_profit');
 return {status:'management_estimate',profitBeforeTaxKopecks,
   taxKopecks,profitAfterTaxKopecks,scope:'IP_ONLY'};
}

const RUB=n=>new Intl.NumberFormat('ru-RU',
 {style:'currency',currency:'RUB'}).format(n/100);
export function describeOctoberAllocation(summary){
 if(!summary||summary.month!=='2026-10')throw Error('invalid_owner_decisions');
 const overhead=summary.overheadAllocation;
 return 'ОБЩИЙ НАЛОГ ИП · ОКТЯБРЬ 2026: '+RUB(summary.taxKopecks)+
  '\nНалог учитывается ОДИН РАЗ в сводном P&L ИП и НЕ распределяется между Ozon, WB и отдельным ООО.'+
  '\nСводная прибыль ИП после налога: пока неизвестна — не все каналы закрыты.'+
  '\nОбщие расходы бизнеса: '+RUB(summary.overheadKopecks)+' в месяц.'+
  '\nДоля общих расходов Ozon: '+
  (overhead?.status==='allocated_management_only'?
    RUB(overhead.allocations.ozon):
    'не рассчитана: нет подтверждённой выручки всех каналов')+
  '\nОбщий налог нельзя повторно вычитать из прибыли отдельных маркетплейсов.'+
  ' Подтверждённая чистая прибыль пока недоступна.';
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
