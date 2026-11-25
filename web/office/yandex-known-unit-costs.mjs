import {ownerCoverCostFromTitle} from './owner-unit-costs.mjs';
// Explicitly owner-confirmed Yandex costs supplied 10 November 2026,
// plus Lada Niva covers confirmed 31 October 2026.
// Reuse only when the product type and variant are identifiable from title.
// Never infer a generic EVA mat cost from an unknown shape or a car model alone.
const norm=value=>typeof value==='string'?value.normalize('NFKC')
 .toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
 .replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim():'';
const cost=(kopecks,category)=>({
 costKopecks:kopecks,category,source:'OWNER_CONFIRMED_YANDEX_2026-11-10'});
export function knownYandexUnitCost(offer){
 if(!offer||typeof offer!=='object')return null;
 const name=norm(offer.name||offer.offerName);
 // Owner-confirmed on 2026-11-25 for the exact Priora door-card variant
 // sold through Yandex shop 149082506. Not a generic door insert price.
 const exactPrioraCards=Number(offer.partnerId)===149082506&&
  norm(offer.shopSku)==='карты приора серый квадрат'&&
  /(?:дверн.*карт|карт.*двер|вставк.*двер)/.test(name)&&
  /приор|priora/.test(name)&&
  /(?:сер|grey|gray)/.test(name);
 if(exactPrioraCards)return {
  costKopecks:17500,
  category:'Дверные карты Priora · серый квадрат',
  source:'OWNER_CONFIRMED_EXACT_YANDEX_SKU_2026-11-25',
  status:'confirmed_owner_exact_sku'
 };
 // Require an actual title for category inference. A seller SKU or model
 // code without a verified title can represent another physical product.
 if(!name)return null;
 const ownerCover=ownerCoverCostFromTitle(offer.name||offer.offerName);
 if(ownerCover)return ownerCover;
 const sku=norm(offer.shopSku);
 const s=name+' '+sku;
 if(/задн/.test(name)&&/диск/.test(name)&&
   /тормоз/.test(name)&&/ваз|lada|лада/.test(name)&&
   /без\s*abs|без\s*абс/.test(name))
  return cost(1600000,'Задние дисковые тормоза без ABS на ВАЗ');
 const mats=/коврик/.test(name);
 if(mats&&/ворс/.test(name))
  return cost(90000,'Ворсовые автомобильные коврики');
 if(mats&&/\b(?:eva|ева)\b/.test(s)){
  // The more specific variant is checked first; generic EVA not assigned.
  if(/(?:3\s*d|3д|3\s*д)/.test(s)&&/борт/.test(s)&&
     !/без\s*борт/.test(s))
   return cost(130000,'EVA-коврики с 3D-бортами');
  if(/пресс\s*борт/.test(s))
   return cost(110000,'EVA-коврики с пресс-бортами');
  if(/багажник/.test(name))
   return cost(70000,'EVA-коврики в багажник');
  if(/придверн/.test(name))
   return cost(20000,'EVA придверные коврики');
  if(/салон/.test(name)&&!/3\s*d|3д|3\s*д|борт|пресс/.test(s))
   return cost(60000,'EVA-коврики в салон без 3D-бортов');
  return null;
 }
 if(!/(?:авто\s*чехл|авточехл|чехл)/.test(name)||
   /подлокот|двер|накид|кресл\s*детск/.test(name))return null;
 // Exact physical variant confirmed by owner for Ozon SKU 5023073005.
 // Do not generalize to different Vesta Cross colors or trims.
 if(/(?:вест[ауы]|vesta)\s*(?:кросс|cross)/.test(s)&&
   /оранж/.test(s)&&/сот/.test(s)&&
   /(?:поддержк|боков)/.test(s)&&
   (!/син|красн|зелен|бел|сер|черн/.test(name)||/оранж/.test(name)))
  return {costKopecks:450000,
   category:'Vesta Cross с оранжевой поддержкой и оранжевыми сотами',
   source:'OWNER_CONFIRMED_OZON_SKU_5023073005_IDENTICAL_VARIANT'};
 if(/грант|granta/.test(name))return cost(320000,'Авточехлы Lada Granta');
 if(/(?:lada|лада)\s*нива|(?:lada|лада)\s*niva/.test(name)&&
   !/travel|тревел|chevrolet|шевроле/.test(name))
  return cost(320000,'Авточехлы Lada Niva');
 if(/калин|kalina/.test(name))return cost(270000,'Авточехлы Lada Kalina');
 if(/газел|gazelle/.test(name))return cost(300000,'Авточехлы Газель');
 if(/(?:ваз|vaz)\s*2107|(?:lada|лада)\s*2107/.test(name))
  return cost(280000,'Авточехлы ВАЗ 2107');
 if(/\brio\b|рио|solaris|солярис/.test(name))
  return cost(430000,'Авточехлы Rio / Solaris');
 return null;
}
