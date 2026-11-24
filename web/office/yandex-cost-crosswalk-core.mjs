// Common unit-cost crosswalk for Yandex offers and confirmed Ozon/WB sources.
// Never match by fuzzy string similarity; an exact article or an unambiguous
// verified product family is necessary. Money is always integer kopecks.
const valid=x=>Number.isSafeInteger(x)&&x>0&&x<=100000000;
export const normalizeCostKey=x=>typeof x==='string'?
 x.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' '):'';
const has=(s,pattern)=>pattern.test(s);
const accessories=/коврик|eva|багажник|подлокот|двер|карты|вставк|порог|аромат|брелок|бампер|накладк|защит|накидк|зеркал|шторк/;
function modelFamily(text){
 const s=normalizeCostKey(text);
 if(has(s,accessories))return null;
 if(/веста\s*кросс|vesta\s*cross/.test(s))return 'vesta_cross';
 if(/веста|vesta/.test(s))return 'vesta';
 if(/приора|priora/.test(s))return 'priora';
 if(/самара|samara/.test(s))return 'samara';
 if(/искра|iskra/.test(s))return 'iskra';
 return null;
}
function familyFromSource(row,type){
 const key=type==='wb'?row.vendorCode:
   [row.sellerArticle,row.model].filter(Boolean).join(' ');
 return modelFamily(key);
}
function inMonth(x,month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return false;
 const [y,m]=month.split('-').map(Number);
 const end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
 const start=month+'-01';
 return typeof x.validFrom==='string'&&x.validFrom<=start&&
   (x.validTo===null||x.validTo>=end);
}
function confirmedSources(source,month){
 const result=[];
 for(const x of source?.wb?.entries||[]){
  if(x?.status!=='confirmed'||!valid(x.costKopecks)||!inMonth(x,month))continue;
  result.push({channel:'WB',code:x.vendorCode,
   costKopecks:x.costKopecks,family:familyFromSource(x,'wb')});
 }
 for(const x of source?.ozonCatalog?.entries||[]){
  if(x?.status!=='confirmed'||!valid(x.costKopecks))continue;
  result.push({channel:'Ozon',code:x.sellerArticle,
   alternativeCode:x.sku,costKopecks:x.costKopecks,
   family:familyFromSource(x,'ozon')});
 }
 for(const x of source?.ozonProfit?.entries||[]){
  if(x?.status!=='confirmed'||!valid(x.costKopecks)||!inMonth(x,month))
   continue;
  result.push({channel:'Ozon Profit',code:x.sku,
   costKopecks:x.costKopecks,family:null});
 }
 return result.filter(x=>normalizeCostKey(x.code));
}
function resultForOffer(offer,costs){
 const keys=[offer.shopSku,offer.name,offer.offerName].map(normalizeCostKey)
  .filter(Boolean);
 const exact=costs.filter(c=>keys.includes(normalizeCostKey(c.code))||
  c.alternativeCode&&keys.includes(normalizeCostKey(c.alternativeCode)));
 const prices=rows=>[...new Set(rows.map(x=>x.costKopecks))];
 if(exact.length){
  const amounts=prices(exact);
  return amounts.length===1?
   {status:'matched_exact',costKopecks:amounts[0],sources:
    [...new Set(exact.map(x=>x.channel))]}:
   {status:'cost_conflict',costKopecks:null,pricesKopecks:amounts,
    sources:[...new Set(exact.map(x=>x.channel))]};
 }
 const identity=modelFamily([offer.name,offer.offerName,offer.shopSku]
  .filter(Boolean).join(' '));
 if(!identity)return {status:'missing',costKopecks:null};
 const same=costs.filter(x=>x.family===identity);
 const amounts=prices(same);
 if(!amounts.length)return {status:'missing',costKopecks:null};
 if(amounts.length!==1)return {status:'cost_conflict',costKopecks:null,
  pricesKopecks:amounts,sources:[...new Set(same.map(x=>x.channel))]};
 return {status:'matched_model',costKopecks:amounts[0],
  sources:[...new Set(same.map(x=>x.channel))]};
}
export function reconcileYandexSharedCosts(offers,audit,month){
 if(!Array.isArray(offers)||offers.length>250||
    audit?.code!=='unified_finance_source_audit'||
    audit.month!==month||
    audit.wb?.status!=='ready'||
    audit.ozonCatalog?.entries===undefined)
  throw Error('yandex_cost_catalog_incomplete');
 const costs=confirmedSources(audit,month),seen=new Set();
 const rows=offers.map(o=>{
  if(!o||typeof o.shopSku!=='string'||!o.shopSku||
    o.shopSku.length>255||typeof o.partnerId!=='number')
   throw Error('yandex_offer_invalid');
  const k=o.partnerId+':'+o.shopSku;
  if(seen.has(k))throw Error('yandex_offer_duplicate');
  seen.add(k);
  const name=String(o.name||o.offerName||'').slice(0,250);
  return {partnerId:o.partnerId,shopSku:o.shopSku,name,
   ...resultForOffer({...o,name},costs)};
 });
 const statusCounts={};
 for(const row of rows)statusCounts[row.status]=(statusCounts[row.status]||0)+1;
 return {month,rows,matched:rows.filter(x=>x.costKopecks!==null).length,
  total:rows.length,missing:rows.filter(x=>x.status==='missing'),
  conflicting:rows.filter(x=>x.status==='cost_conflict'),
  statuses:statusCounts,netProfitKopecks:null,
  disclaimer:'Unit costs are shared between marketplaces on owner instruction; sold units, refund conditions and shared expenses remain separate profit gates.'};
}
