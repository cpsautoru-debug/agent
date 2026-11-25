// Select ONLY the three marketplaces requested by the owner.
// The SKU cost evidence is a contribution before extra business expenses
// and the IP-wide AUSN tax; it must never be upgraded to verified net profit.
export const MARKETPLACE_CHANNEL_IDS=Object.freeze(['ozon','wb','yandex']);
export function applyYandexCostToChannels(channels,month,evidence){
 if(!channels||typeof channels!=='object'||typeof month!=='string')
  return false;
 // Always invalidate stale or incomplete Yandex results.
 delete channels.yandex;
 if(evidence?.month!==month||
  evidence.status!=='preliminary_cost_reconciled'||
  evidence.netProfitKopecks!==null||
  !Number.isSafeInteger(evidence.preliminaryContributionKopecks)||
  !Number.isSafeInteger(evidence.cogsKopecks)||
  evidence.missingCount!==0||
  // Income is per order; COGS comes from delivery-realization archives.
  // Do not call their subtraction a period-matched channel result.
  evidence.orderRealizationMatched!==true)return false;
 channels.yandex={status:'known_cost_result',
  profitKopecks:evidence.preliminaryContributionKopecks};
 return true;
}
