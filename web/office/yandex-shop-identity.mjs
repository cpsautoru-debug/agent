// Yandex has historically serialized campaign identifiers as both numbers
// and numeric strings. Never use businessId for store attribution:
// both owner-confirmed shops share the same business.
const OWNED_SHOPS=new Map([
 [149082506,'Студия Авто Дизайна (САД)'],
 [149106500,'автосклад']
]);
const NAME_TO_SHOP=new Map([...OWNED_SHOPS].map(([id,name])=>[
 normalizeName(name),id]));
// Verified against October 2026 source: 82 order rows carry partnerId
// 216779061 and shopName "Студия Авто Дизайна (САД)". Yandex's report
// partnerId is the shop ID, not the same identifier as API campaignId.
const VERIFIED_REPORT_PARTNERS=new Map([[216779061,149082506]]);
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
 const names=[row.shopName,row.partnerName].filter(v=>v!=null&&v!=='');
 const matchedNames=names.map(v=>NAME_TO_SHOP.get(normalizeName(v))||null);
 if(matchedNames.length&&matchedNames.some(v=>v===null||
    v!==matchedNames[0]))return null;
 const name=matchedNames[0]||null;
 const campaign=verifiedId(row.campaignId);
 const directPartner=verifiedId(row.partnerId);
 const sourcePartner=typeof row.partnerId==='number'?
  row.partnerId:typeof row.partnerId==='string'&&
   /^\d{1,15}$/.test(row.partnerId.trim())?
    Number(row.partnerId.trim()):null;
 const mappedPartner=sourcePartner===null?null:
  VERIFIED_REPORT_PARTNERS.get(sourcePartner)||null;
 // An unseen partner ID could belong to a different business or shop.
 // Do not trust a familiar shop name alone when it contradicts a
 // separately supplied, unequal businessId and partnerId.
 if(row.partnerId!=null&&row.partnerId!==''&&
    !directPartner&&!mappedPartner)return null;
 const sources=[campaign,directPartner,mappedPartner,name].filter(Boolean);
 if(!sources.length||sources.some(id=>id!==sources[0]))return null;
 // A recognized ID or exact owner-confirmed name is required;
 // businessId is shared by both stores and never used to pick a shop.
 return sources[0];
}
export function yandexShopIdentityEvidence(rows){
 const keys=['partnerId','campaignId','shopName','partnerName','businessId'];
 const present=Object.fromEntries(keys.map(k=>[k,0]));
 const unmatched={};
 let verified=0,conflictingOrUnknown=0,partnerIsBusiness=0,
  recognizedShopNames=0;
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  for(const key of keys)if(row[key]!==undefined&&row[key]!==null)
   present[key]++;
  if(sameIdentity(row.partnerId,row.businessId))partnerIsBusiness++;
  if(NAME_TO_SHOP.has(normalizeName(row.shopName))||
     NAME_TO_SHOP.has(normalizeName(row.partnerName)))recognizedShopNames++;
  if(resolveYandexShop(row)!==null)verified++;
  else{
   conflictingOrUnknown++;
   for(const field of ['partnerId','campaignId','shopName','partnerName','businessId']){
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
