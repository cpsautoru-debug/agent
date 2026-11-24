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
 return !!x&&x===y&&/^\\d{1,15}$/.test(x);
}
export function resolveYandexShop(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const name=row.shopName===undefined||row.shopName===null?
  null:NAME_TO_SHOP.get(normalizeName(row.shopName))||null;
 const campaign=verifiedId(row.campaignId);
 const partner=verifiedId(row.partnerId);
 // A campaign ID is a strong shop identifier, but it must not contradict
 // a recognized shopName or a separately recognized partner ID.
 if(campaign!==null){
  if(name!==null&&name!==campaign||partner!==null&&partner!==campaign)
   return null;
  // Unknown partner IDs are only tolerated if explicitly equal to the
  // business-level ID, indicating an ООО identifier rather than a shop ID.
  if(row.partnerId!=null&&partner===null&&
    !sameIdentity(row.partnerId,row.businessId))return null;
  return campaign;
 }
 if(partner!==null){
  if(name!==null&&name!==partner)return null;
  return partner;
 }
 // Yandex financial report rows may use partnerId for the common business.
 // Only permit shopName attribution when this is independently evidenced
 // by partnerId === businessId. Two shops share that business ID.
 if(name!==null&&sameIdentity(row.partnerId,row.businessId))
  return name;
 // Missing partnerId is allowed with an exact, unambiguous shop name.
 if(name!==null&&(row.partnerId===undefined||row.partnerId===null||
    row.partnerId===''))return name;
 return null;
}
export function yandexShopIdentityEvidence(rows){
 const keys=['partnerId','campaignId','shopName','businessId'];
 const present=Object.fromEntries(keys.map(k=>[k,0]));
 const unmatched={};
 let verified=0,conflictingOrUnknown=0;
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  for(const key of keys)if(row[key]!==undefined&&row[key]!==null)
   present[key]++;
  if(resolveYandexShop(row)!==null)verified++;
  else{
   conflictingOrUnknown++;
   for(const field of ['partnerId','campaignId','shopName']){
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
  examples:unmatched,
  note:'Only campaign/partner IDs for known shops or exact known shop names can establish store identity.'};
}
