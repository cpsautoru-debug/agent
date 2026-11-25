import {collectYandexRealizationCandidates,
 reconcileYandexRealizationCosts,buildYandexSafeSkuEvidence,
 applicableYandexCampaigns}
 from './yandex-realization-cost-evidence.mjs';
import {reconcileYandexSharedCosts} from './yandex-cost-crosswalk-core.mjs';
import {buildYandexPreliminaryContribution} from './yandex-contribution-core.mjs';
import {buildYandexMonthlyEvidence} from './yandex-month-evidence.mjs';

// Pure, no customer/order data in the output. Never use Yandex catalog
// purchasePrice or approximate model-family matches as confirmed COGS.
// The realization report may omit the product title although its order
// archive contains the exact seller SKU + campaign. This is an identity
// enrichment only; money and sold quantities still come from official audits.
export function collectYandexVerifiedOfferNames(orders){
 const mapped=new Map();
 if(orders?.code!=='yandex_report_archive_audited'||
  orders.readOnly!==true||orders.changedRecords!==0||
  !Array.isArray(orders.sheets))return mapped;
 for(const sheet of orders.sheets){
  if(!/orders_and_offers_transactions\.json$/.test(sheet.sheet)||
   !Array.isArray(sheet.skuCandidates))continue;
  for(const row of sheet.skuCandidates){
   if(![149082506,149106500].includes(row?.partnerId)||
    typeof row.shopSku!=='string'||!row.shopSku||
    row.shopSku.length>150||
    typeof row.offerName!=='string'||!row.offerName.trim())continue;
   const id=row.partnerId+':'+row.shopSku;
   if(mapped.has(id)&&mapped.get(id)!==row.offerName.trim())
    mapped.set(id,null); // Conflicting official titles: no inference.
   else if(!mapped.has(id))mapped.set(id,row.offerName.trim().slice(0,200));
  }
 }
 return mapped;
}
export function reconcileDirectYandexMonth(month,sources,realizations,costAudit,
 {catalogOfferNames={}}={}){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||'')||
  !sources||!realizations||!costAudit)
  throw Error('yandex_direct_inputs_invalid');
 const active=applicableYandexCampaigns(month);
 // Fail closed if an archived store has actual rows in current order
 // reports. NO_DATA alone is not proof of zero, but an archived report
 // need not be mandatory when the owner confirmed SAD as sole seller.
 const archivedActivity=(sources.orders?.sheets||[]).some(sheet=>
  (sheet.shops||[]).some(shop=>
   Number(shop.partnerId)===149106500&&!active.includes(149106500)&&
   Number.isSafeInteger(shop.rows)&&shop.rows>0));
 const candidates=collectYandexRealizationCandidates(realizations,month);
 const officialNames=collectYandexVerifiedOfferNames(sources.orders);
 const named=candidates.map(x=>{
  const title=x.offerName||officialNames.get(x.partnerId+':'+x.shopSku)||
   (typeof catalogOfferNames?.[x.shopSku]==='string'?
    catalogOfferNames[x.shopSku]:'');
  return {...x,offerName:title,name:title,
   catalogName:typeof catalogOfferNames?.[x.shopSku]==='string'?
    catalogOfferNames[x.shopSku]:''};
 });
 const costs=reconcileYandexSharedCosts(named,costAudit,month);
 const ledger=buildYandexSafeSkuEvidence(costs,realizations);
 const summary=buildYandexPreliminaryContribution(sources,costs,realizations);
 const finance=buildYandexMonthlyEvidence(sources);
 const missing=ledger.missing;
 // Owner-only SKU evidence: qty is taken from realization archive;
 // unit cost from dated exact/owner-confirmed crosswalk. NO order PII.
 const skuAudit=ledger.rows.slice(0,150).map(x=>{
  const qty=Number.isSafeInteger(x.deliveredUnits)?x.deliveredUnits:null;
  const unit=Number.isSafeInteger(x.costKopecks)?x.costKopecks:null;
  const line=Number.isSafeInteger(qty)&&Number.isSafeInteger(unit)?
   qty*unit:null;
  return {shopSku:x.shopSku,name:x.name,
   deliveredUnits:qty,returnedUnits:x.returnedUnits,
   unitCostKopecks:unit,deliveredCostKopecks:
    Number.isSafeInteger(line)?line:null,costStatus:x.costStatus};
 });
 const skuAuditSum=skuAudit.reduce((total,x)=>
  Number.isSafeInteger(total)&&
  Number.isSafeInteger(x.deliveredCostKopecks)?
   total+x.deliveredCostKopecks:null,0);
 const skuAuditMatches=skuAudit.length===ledger.rows.length&&
  Number.isSafeInteger(skuAuditSum)&&
  skuAuditSum===summary.deliveredManufacturingCostKopecks;
 const complete=!archivedActivity&&skuAuditMatches&&
  summary.status==='preliminary_contribution_ready'&&
  ledger.issues.length===0&&missing.length===0;
 return {code:'yandex_direct_cost_review',month,readOnly:true,
  ownerEntity:'ИП Жилина Ольга',
  status:complete?'preliminary_cost_reconciled':'incomplete_cost_coverage',
  incomeKopecks:finance.preliminaryOrderAfterServiceKopecks,
  orderRows:finance.orderMargin?.rows??null,
  // Safe source-only diagnosis for the owner: no customer/order details.
  serviceAudit:finance.services?.sheets?.map(sheet=>({
   sheet:sheet.name,rows:sheet.rows,
   amountField:sheet.amountField,
   amountRows:sheet.amount?.rows??0,
   amountInvalid:sheet.invalidRows??0,
   missingAmountRows:sheet.uncoveredRows??null,
   amountKopecks:sheet.amount?.kopecks??null,
   candidateAmountFields:sheet.candidates||[]
  }))??[],
  cogsKopecks:summary.deliveredManufacturingCostKopecks,
  indicativeReturnCostKopecks:summary.returnsIndicativeCostKopecks,
  preliminaryContributionKopecks:complete?
   summary.preliminaryContributionKopecks:null,
  reviewContributionBeforeReturnsKopecks:!archivedActivity&&
   Number.isSafeInteger(summary.reviewContributionBeforeReturnsKopecks)?
   summary.reviewContributionBeforeReturnsKopecks:null,
  skuAudit,skuAuditSumKopecks:skuAuditMatches?skuAuditSum:null,
  deliveredUnits:skuAudit.reduce((n,x)=>n+(x.deliveredUnits??0),0),
  returnedUnits:skuAudit.reduce((n,x)=>n+(x.returnedUnits??0),0),
  skuAuditMatches,
  missing,issues:ledger.issues,
  blockers:[...summary.blockers,...(archivedActivity?['archived_campaign_has_order_rows']:[])],
  activeCampaigns:active,archivedCampaigns:[149106500].filter(id=>!active.includes(id)),
  skuCount:ledger.rows.length,netProfitKopecks:null,
  note:'Промежуточный результат после себестоимости: '+
   'не чистая прибыль ИП. Возвраты, период услуг, реклама, АУСН '+
   'и общие расходы требуют независимой проверки.'};
}
