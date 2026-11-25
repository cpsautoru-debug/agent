// Owner-provided FNS AУСН payable shown for OCTOBER 2026.
// Source: FNS notice 5829914, dated 2026-11-13; owner confirmed 205507 RUB.
// October-only operational planning, not a cross-channel certified tax ledger.
// Never apply to other months and never subtract it twice.
const OWNER_REFERENCE=Object.freeze({
 month:'2026-10',
 taxKopecks:20550700,
 ownerEntity:'ИП Жилина Ольга',
 documentNumber:'5829914',
 documentDate:'2026-11-13',
 source:'OWNER_CONFIRMED_FNS_PAYABLE',
 appliesTo:'whole_ip'
});
export function ownerFnsTaxReference(month){
 return month===OWNER_REFERENCE.month?{...OWNER_REFERENCE}:null;
}
