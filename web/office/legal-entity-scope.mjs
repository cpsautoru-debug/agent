// Owner-verified financial scope for AutoSklad63. The owner explicitly
// confirmed that the already connected Yandex API belongs to IP Zhilina
// Olga. Earlier assistant statements about a third-party LLC were WRONG.
export const AUTOSKLAD63_LEGAL_ENTITY=Object.freeze({
 type:'ИП',
 holder:'Жилина Ольга',
 displayName:'ИП Жилина Ольга',
 source:'OWNER_EXPLICIT_CONFIRMATION_2026_11_24'
});
export const YANDEX_OWNER_REPORT_SCOPE=Object.freeze({
 status:'owner_confirmed',
 legalEntity:AUTOSKLAD63_LEGAL_ENTITY.displayName,
 expectedSource:'existing_connected_yandex_api',
 // Both known campaigns belong to this same owner per explicit correction.
 campaignIds:Object.freeze([149082506,149106500]),
});
export function yandexEvidenceAllowedForBusiness(){
 return YANDEX_OWNER_REPORT_SCOPE.status==='owner_confirmed';
}
