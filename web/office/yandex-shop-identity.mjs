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
export function resolveYandexShop(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const ids=[];
 for(const field of ['partnerId','campaignId']){
  const raw=row[field];
  if(raw!==undefined&&raw!==null&&raw!==''){
   const matched=verifiedId(raw);
   if(matched===null)return null;
   ids.push(matched);
  }
 }
 if(row.shopName!==undefined&&row.shopName!==null&&row.shopName!==''){
  const byName=NAME_TO_SHOP.get(normalizeName(row.shopName));
  if(!byName)return null;
  ids.push(byName);
 }
 if(!ids.length||ids.some(x=>x!==ids[0]))return null;
 return ids[0];
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
