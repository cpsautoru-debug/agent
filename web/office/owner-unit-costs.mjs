// Canonical owner-confirmed manufacturing unit cost reference for all channels.
// Prices are in integer kopecks and are NOT SKU identity attestations.
// Dates/variants and return condition are independently verified before P&L.
export const OWNER_UNIT_COSTS=Object.freeze({
 vesta: Object.freeze({label:'Lada Vesta · авточехлы',costKopecks:420000}),
 vesta_cross: Object.freeze({label:'Lada Vesta Cross · авточехлы',costKopecks:450000}),
 iskra: Object.freeze({label:'Lada Iskra · авточехлы',costKopecks:469700}),
 priora: Object.freeze({label:'Lada Priora · авточехлы',costKopecks:319900}),
 samara: Object.freeze({label:'Lada Samara · авточехлы',costKopecks:320000}),
 door_cards: Object.freeze({label:'Дверные вставки',costKopecks:35000}),
 armrest_cover: Object.freeze({label:'Чехол подлокотника Vesta',costKopecks:10000}),
 keychain: Object.freeze({label:'Брелок',costKopecks:5000}),
 fragrance: Object.freeze({label:'Ароматизатор',costKopecks:26000}),
 kalina_bumper_trim: Object.freeze({label:'Накладка Kalina Cross',costKopecks:30000})
});
export const OWNER_COST_SOURCE='OWNER_CONFIRMED_BUSINESS_COST_REFERENCE_2026';
const norm=s=>typeof s==='string'?s.normalize('NFKC')
 .toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
 .replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim():'';
// A verified product title is required. Never guess from marketplace SKU alone.
export function ownerCoverCostFromTitle(title){
 const s=norm(title);
 if(!s||!/(авточехл|авто чехл|чехл|сиден)/.test(s)||
    /(подлокот|двер|накидк|коврик|брелок|аромат|накладк|универсальн)/.test(s))return null;
 let key=null;
 if(/(?:вест[ауы]|vesta)\s*(?:кросс|cross)/.test(s))key='vesta_cross';
 else if(/(?:вест[ауы]|vesta)/.test(s))key='vesta';
 else if(/(?:искра|iskra)/.test(s))key='iskra';
 else if(/(?:приора|priora)/.test(s))key='priora';
 else if(/(?:самара|samara)/.test(s))key='samara';
 if(!key)return null;
 const entry=OWNER_UNIT_COSTS[key];
 return {key,category:entry.label,costKopecks:entry.costKopecks,
  source:OWNER_COST_SOURCE,status:'owner_model_reference',
  skuIdentityVerified:false,validFromVerified:false};
}

/** Strict title-only review. No date-of-sale or historical bundle certification. */
export function ownerProductCostFromOfficialTitle(title){
 const raw=typeof title==='string'?title:'';
 const s=norm(raw);
 if(!s)return null;
 if(/вставк/.test(s)&&/двер|карт/.test(s)&&
    /экокож|эко кож/.test(s)){
  return {key:'door_cards',category:OWNER_UNIT_COSTS.door_cards.label,
   costKopecks:OWNER_UNIT_COSTS.door_cards.costKopecks,
   source:OWNER_COST_SOURCE,status:'owner_category_reference',
   historicalCostVerified:false};
 }
 if(/коврик/.test(s)&&/ева|eva/.test(s)&&/пресс\s*борт/.test(s)){
  if(/3\s*d|3д|3\s*д/.test(s))return null; // overlapping 3D and press trim
  return {key:'eva_press_board',category:'EVA коврики с пресс-бортами',
   costKopecks:110000,source:'OWNER_CONFIRMED_YANDEX_2026-11-10',
   status:'owner_category_reference',historicalCostVerified:false};
 }
 if(/(?:авто\s*чехл|авточехл|чехл)/.test(s)&&
    /(?:\bнива\b|\bniva\b)/.test(s)&&
    !/travel|тревел|шевроле|chevrolet/.test(s))
  return {key:'niva',category:'Авточехлы Lada Niva',
   costKopecks:320000,source:'OWNER_CONFIRMED_YANDEX_2026-10-31',
   status:'owner_category_reference',historicalCostVerified:false};
 return ownerCoverCostFromTitle(raw);
}
