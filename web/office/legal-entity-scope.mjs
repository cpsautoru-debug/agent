// Business-level legal-entity gate, based on the owner's explicit correction
// on 24 November 2026. Third-party LLC source reports are NOT AutoSklad63 data.
// Do not delete the archived data: quarantine it from company calculations.
export const AUTOSKLAD63_LEGAL_ENTITY=Object.freeze({
 type:'ИП',holder:'Жилина Ольга',
 displayName:'ИП Жилина Ольга'
});
export const EXCLUDED_THIRD_PARTY_YANDEX_CAMPAIGNS=Object.freeze([
 149082506,149106500
]);
export const YANDEX_OWNER_REPORT_SCOPE=Object.freeze({
 status:'not_verified_for_ip',
 legalEntity:AUTOSKLAD63_LEGAL_ENTITY.displayName,
 // The previously connected campaign IDs are confirmed as unrelated LLC data.
 excludedCampaignIds:EXCLUDED_THIRD_PARTY_YANDEX_CAMPAIGNS,
 expectedSource:'previously_uploaded_owner_ip_reports',
});
export function yandexEvidenceAllowedForBusiness(){
 // No trusted IP-owner business/campaign mapping is currently available.
 // Never infer it from an API token, a report DONE status or a shop name.
 return false;
}
export function excludedYandexIncome(month){
 return {month,status:'unavailable',incomeKopecks:null,
  netProfitKopecks:null,orders:null,
  reason:'third_party_llc_source_excluded',
  legalEntity:AUTOSKLAD63_LEGAL_ENTITY.displayName,
  sourceVerified:false};
}
