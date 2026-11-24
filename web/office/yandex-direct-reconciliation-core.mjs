import {collectYandexRealizationCandidates,
 reconcileYandexRealizationCosts,buildYandexSafeSkuEvidence}
 from './yandex-realization-cost-evidence.mjs';
import {reconcileYandexSharedCosts} from './yandex-cost-crosswalk-core.mjs';
import {buildYandexPreliminaryContribution} from './yandex-contribution-core.mjs';
import {buildYandexMonthlyEvidence} from './yandex-month-evidence.mjs';

// Pure, no customer/order data in the output. Never use Yandex catalog
// purchasePrice or approximate model-family matches as confirmed COGS.
export function reconcileDirectYandexMonth(month,sources,realizations,costAudit){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||'')||
  !sources||!realizations||!costAudit)
  throw Error('yandex_direct_inputs_invalid');
 const candidates=collectYandexRealizationCandidates(realizations);
 const named=candidates.map(x=>({...x,name:x.offerName}));
 const costs=reconcileYandexSharedCosts(named,costAudit,month);
 const ledger=buildYandexSafeSkuEvidence(costs,realizations);
 const summary=buildYandexPreliminaryContribution(sources,costs,realizations);
 const finance=buildYandexMonthlyEvidence(sources);
 const missing=ledger.missing;
 const complete=summary.status==='preliminary_contribution_ready'&&
  ledger.issues.length===0&&missing.length===0;
 return {code:'yandex_direct_cost_review',month,readOnly:true,
  ownerEntity:'ИП Жилина Ольга',
  status:complete?'preliminary_cost_reconciled':'incomplete_cost_coverage',
  incomeKopecks:finance.preliminaryOrderAfterServiceKopecks,
  orderRows:finance.orderMargin?.rows??null,
  cogsKopecks:summary.deliveredManufacturingCostKopecks,
  indicativeReturnCostKopecks:summary.returnsIndicativeCostKopecks,
  preliminaryContributionKopecks:complete?
   summary.preliminaryContributionKopecks:null,
  missing,issues:ledger.issues,blockers:summary.blockers,
  skuCount:ledger.rows.length,netProfitKopecks:null,
  note:'Промежуточный результат после себестоимости: '+
   'не чистая прибыль ИП. Возвраты, период услуг, реклама, АУСН '+
   'и общие расходы требуют независимой проверки.'};
}
