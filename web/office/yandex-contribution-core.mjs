import {buildYandexMonthlyEvidence} from './yandex-month-evidence.mjs';
import {reconcileYandexRealizationCosts} from './yandex-realization-cost-evidence.mjs';
// Source-only preliminary contribution, not statutory net profit. Does not
// re-subtract summaryCommission or the overlapping service report.
export function buildYandexPreliminaryContribution(sources,costAudit,realizationReports){
 const finance=buildYandexMonthlyEvidence(sources);
 const result={status:'incomplete',preliminaryContributionKopecks:null,
  orderAfterServicesKopecks:finance.preliminaryOrderAfterServiceKopecks,
  deliveredManufacturingCostKopecks:null,
  returnsIndicativeCostKopecks:null,netProfitKopecks:null,
  missing:[],blockers:[],note:'Доход после учтённых услуг минус подтверждённая себестоимость доставленных. НЕ чистая прибыль; не учитывает отдельно невыверенные услуги, возвраты, налоги и общие расходы.'};
 if(!Number.isSafeInteger(finance.preliminaryOrderAfterServiceKopecks)){
  result.blockers.push('order_income_not_verified');
 }
 if(finance.missing.length)result.blockers.push('three_reports_not_verified');
 for(const b of finance.blocks){
  if(['service_amount_coverage_incomplete',
   'payment_coverage_incomplete'].includes(b))result.blockers.push(b);
 }
 if(!costAudit||!Array.isArray(costAudit.rows)||!realizationReports){
  result.blockers.push('realization_cost_source_missing');
  return result;
 }
 const costs=reconcileYandexRealizationCosts(costAudit,realizationReports);
 result.costStatus=costs.status;
 result.missing=costs.missing;
 result.byShop=costs.byShop;
 result.deliveredManufacturingCostKopecks=costs.totalDeliveredCostKopecks;
 result.returnsIndicativeCostKopecks=costs.totalReturnedValueKopecks;
 if(costs.status!=='two_shops_cost_verified')
  result.blockers.push('both_shops_delivery_return_cost_incomplete');
 if(result.blockers.length)return result;
 const preliminary=finance.preliminaryOrderAfterServiceKopecks-
  costs.totalDeliveredCostKopecks;
 if(!Number.isSafeInteger(preliminary)){
  result.blockers.push('amount_overflow');return result;
 }
 result.preliminaryContributionKopecks=preliminary;
 result.status='preliminary_contribution_ready';
 return result;
}
