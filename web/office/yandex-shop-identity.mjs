// Yandex has historically serialized campaign identifiers as both numbers
// and numeric strings. Never use businessId for store attribution:
// both owner-confirmed shops share the same business.
const OWNED_SHOPS=new Map([
 [149082506,'Студия Авто Дизайна (САД)'],
 [149106500,'автосклад']
]);
const NAME_TO_SHOP=new Map([...OWNED_SHOPS].map(([id,name])=>[
 normalizeName(name),id]));
function normalizeName(value){
 return typeof value==='string'?
  value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU'):'';
}
function verifiedId(value){
 if(typeof value==='number')return Number.isSafeInteger(value)&&
  OWNED_SHOPS.has(value)?value:null;
 if(typeof value==='string'&&/^\d{1,15}$/.test(value.trim())){
  const id=Number(value.trim());
  return Number.isSafeInteger(id)&&OWNED_SHOPS.has(id)?id:null;
 }
 return null;
}
function sameIdentity(a,b){
 const x=typeof a==='number'?String(a):typeof a==='string'?a.trim():'';
 const y=typeof b==='number'?String(b):typeof b==='string'?b.trim():'';
 return !!x&&x===y&&/^\d{1,15}$/.test(x);
}
export function resolveYandexShop(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const name=row.shopName===undefined||row.shopName===null?
  null:NAME_TO_SHOP.get(normalizeName(row.shopName))||null;
 const campaign=verifiedId(row.campaignId);
 const partner=verifiedId(row.partnerId);

 // Strong campaign ID or a recognized partner ID takes precedence.
 // Any conflict with a known shopName means no attribution.
 if(campaign!==null&&partner!==null&&campaign!==partner)return null;
 if(campaign!==null&&name!==null&&campaign!==name)return null;
 if(partner!==null&&name!==null&&partner!==name)return null;
 if(campaign!==null)return campaign;
 if(partner!==null)return partner;

 // Yandex finance reports may have a merchant-specific partnerId distinct
 // from businessId and campaignId. Proven October 2026 source:
 // partnerId 216779061, businessId 216779062, shopName
 // "Студия Авто Дизайна (САД)". These DIFFERENT identifiers are valid.
 // The exact owner-confirmed shopName is sufficient for the current row,
 // provided that any present ID is well-formed; merchant ID itself is
 // never treated as a campaign ID or applied to other rows.
 if(name!==null){
  for(const value of [row.partnerId,row.businessId,row.campaignId]){
   if(value===undefined||value===null||value==='')continue;
   const candidate=typeof value==='number'&&Number.isSafeInteger(value)?
    String(value):typeof value==='string'?value.trim():'';
   if(!/^\d{1,15}$/.test(candidate))return null;
  }
  return name;
 }
 return null;
}
export function yandexShopIdentityEvidence(rows){
 const keys=['partnerId','campaignId','shopName','businessId'];
 const present=Object.fromEntries(keys.map(k=>[k,0]));
 const unmatched={};
 let verified=0,conflictingOrUnknown=0,partnerIsBusiness=0,
  recognizedShopNames=0;
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  for(const key of keys)if(row[key]!==undefined&&row[key]!==null)
   present[key]++;
  if(sameIdentity(row.partnerId,row.businessId))partnerIsBusiness++;
  if(NAME_TO_SHOP.has(normalizeName(row.shopName)))recognizedShopNames++;
  if(resolveYandexShop(row)!==null)verified++;
  else{
   conflictingOrUnknown++;
   for(const field of ['partnerId','campaignId','shopName','businessId']){
    const raw=row[field];
    if(raw===undefined||raw===null)continue;
    const safe=typeof raw==='number'&&Number.isSafeInteger(raw)?
     String(raw):typeof raw==='string'&&raw.length<=80?raw:null;
    if(safe===null)continue;
    const list=unmatched[field]||[];
    if(!list.includes(safe)&&list.length<3)list.push(safe);
    unmatched[field]=list;
   }
  }
 }
 return {present,verified,unmatchedRows:conflictingOrUnknown,
  partnerIsBusiness,recognizedShopNames,
  examples:unmatched,
  note:'Only campaign/partner IDs for known shops or exact known shop names can establish store identity.'};
}
