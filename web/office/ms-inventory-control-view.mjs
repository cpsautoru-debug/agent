import {classifyCatalogPath} from './ms-materials-by-catalog.mjs';

// Business classification is grounded only in actual catalog folders.
// Never infer finished stock from a completed production STAGE, or classify
// cuts from production-task counts. Unknown catalog groups stay visible.
const norm=s=>s.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
const SPLIT=/[\/\\]/;
const cutNames=new Set(['крой','крой чехлов','комплекты кроя','раскроенные детали']);
const finishedNames=new Set(['готовая продукция','готовые изделия','готовые авточехлы','готовые комплекты']);
export const LOW_MATERIAL_METERS=40;
const validStr=(s,max=180)=>typeof s==='string'&&s.length>0&&s.length<=max&&
  !/[\u0000-\u001f\u007f]/u.test(s);
export function isMeterUnit(uom){
  if(!validStr(uom,30))return false;
  return new Set(['м','м.','метр','метры','п.м','п.м.','пог.м','пог. м','погонный метр','погонные метры'])
    .has(norm(uom).replace(/\s+/gu,' '));
}
// These are display-only domain rules, not updates to the MoySklad catalog.
// Out-of-scope merchandise (EVA carpets, accessories, parts) never reaches
// owner-facing rows, statistics, low-stock alerts or model sub-tables.
// Unknown items remain in MoySklad; do not treat them as zero inventory.
const excludedItem=/ковр|(?:^|[\s/_-])(?:eva|эва)(?=$|[\s/_-])|ароматиз|брелок|бампер|радиатор|подлокотник|накладк|порог|тормозн|накидк|тюбинг|держател|органайзер|чехол\s+руля/iu;
const coverWords=/авточехл|чехл/iu;
const doorWords=/(?:дверн.{0,28}(?:карт|встав))|(?:(?:карт|встав).{0,28}двер)/iu;
const modelWords=/(?:^|[\s/_()-])(?:vesta|веста|приора|priora|samara|самара|granta|гранта|iskra|искра|калина|kalina|niva|нива|creta|крета|rio|рио|solaris|солярис|лада|lada|2107|2114|2110|2115)(?=$|[\s/_()-])/iu;
const materialWords=/экокож|алькантар|спанбонд|поролон|перфорац|стёжк|стежк|нитк|пегас|pegas|подклад|кож[аеи]|ткан[ьи]|обивочн/iu;
const materialFolder=/материал|экокожа|альк|поролон|перфорац|спанбонд|стёжк|стежк|нитк|подклад|кож|ткан|pegas|пегас/iu;
const productionRoot=new Set(['производство','производственные материалы']);
const coverFolders=/авточехл|чехл|сиден/iu;
const cutFolders=new Set(['крой','крой чехлов','комплекты кроя','раскроенные детали']);
const finishedFolders=new Set(['готовая продукция','готовые изделия','готовые авточехлы','готовые комплекты']);

export function classifyInventory(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return 'excluded';
  const name=validStr(item.name)?norm(item.name):'';
  const path=validStr(item.catalogPath)?item.catalogPath:'';
  const code=validStr(item.code,70)?norm(item.code):'';
  const full=norm([name,path,code].join(' '));
  // Product names, paths and SKU can identify excluded goods. An EVA group
  // cannot be reintroduced as "finished" merely because it sits under production.
  if(excludedItem.test(full))return 'excluded';
  const parts=path?path.split(SPLIT).map(norm):[];
  if(parts.some(x=>!x))return 'excluded';
  const production=parts.length>0&&productionRoot.has(parts[0]);
  const hasCut=parts.some(x=>cutFolders.has(x));
  const hasFinished=parts.some(x=>finishedFolders.has(x));
  const covers=(coverWords.test(name)||parts.some(x=>coverFolders.test(x)))&&
    (production||coverWords.test(name)||parts.some(x=>coverFolders.test(x)));
  const door=doorWords.test([name,path].join(' '));
  const hasModel=modelWords.test(name);
  const material=classifyCatalogPath(path)==='MATERIAL_FOLDER_EVIDENCE'||
    (production&&(parts.slice(1).some(x=>materialFolder.test(x))||
      materialWords.test(name)&&!covers&&!door))||
    (materialWords.test(name)&&
      (parts[0]==='материалы'||!path));
  // Material and cut are not sellable stock even if the part has a model name.
  if(hasCut&&(production||covers||door||hasModel))return 'cut';
  if(material)return 'materials';
  if(door)return 'doorCards';
  if(hasFinished&&(production||covers||hasModel))return 'finished';
  if(covers&&(production||hasModel||coverWords.test(name)))return 'covers';
  if(production&&hasModel)return 'unverified';
  return 'excluded';
}
export function isProductionAssortment(item){
  return classifyInventory(item)!=='excluded';
}

export function checkInventoryPage(payload,offset){
  if(!Number.isSafeInteger(offset)||offset<0||offset>4990||offset%10!==0||
    payload?.code!=='ms_stock_bystore_ok'||
    payload.source!=='MOYSKLAD_STOCK_BYSTORE_AND_ASSORTMENT'||
    payload.scope!=='PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY'||
    payload.readOnly!==true||payload.changedRecords!==0||
    payload.offset!==offset||payload.pageSize!==10||
    !Number.isSafeInteger(payload.totalAssortmentReportRows)||
    payload.totalAssortmentReportRows<0||
    !Array.isArray(payload.items)||payload.items.length>10||
    typeof payload.hasMore!=='boolean'||!Number.isSafeInteger(payload.namesResolved)||
    payload.namesResolved<0||payload.namesResolved>payload.items.length||
    payload.items.length!==Math.min(10,Math.max(0,payload.totalAssortmentReportRows-offset))||
    payload.hasMore!==(offset+payload.items.length<payload.totalAssortmentReportRows&&offset<4990))
    throw Error('inventory_report_unverified');
  for(const item of payload.items){
    if(!item||typeof item!=='object'||Array.isArray(item)||
      (item.name!==null&&!validStr(item.name))||
      (item.code!==null&&!validStr(item.code,70))||
      (item.uom!==null&&!validStr(item.uom,50))||
      (item.catalogPath!==null&&!validStr(item.catalogPath))||
      !Array.isArray(item.stores)||item.stores.length>30)throw Error('inventory_report_unverified');
    const stores=new Set();
    for(const store of item.stores){
      if(!validStr(store?.name,120)||stores.has(store.name)||
        (store.stock!==null&&(!Number.isFinite(store.stock)||Math.abs(store.stock)>1e9))||
        (store.reserve!==null&&(!Number.isFinite(store.reserve)||Math.abs(store.reserve)>1e9))||
        (store.inTransit!==null&&(!Number.isFinite(store.inTransit)||Math.abs(store.inTransit)>1e9)))
        throw Error('inventory_report_unverified');
      stores.add(store.name);
    }
  }
  return payload;
}
export function inventoryRows(items,store='all',query='',category='all'){
  if(!Array.isArray(items)||items.length>5000||
    typeof store!=='string'||!validStr(store,120)||
    typeof query!=='string'||query.length>120||
    !['all','materials','cut','finished','covers','doorCards','unverified','low','negative'].includes(category))
    throw Error('inventory_filters_invalid');
  const search=norm(query);
  const out=[];
  for(const item of items){
    const cat=classifyInventory(item);
    if(cat==='excluded')continue;
    if(!Array.isArray(item?.stores))throw Error('inventory_unverified');
    if(search&&!norm([item.name,item.code,item.catalogPath].filter(Boolean).join(' ')).includes(search))
      continue;
    // The report can omit store rows. Such absence is unknown, never zero.
    const locations=item.stores.length?item.stores:
      [{name:'Склад не указан',stock:null,reserve:null,inTransit:null}];
    for(const location of locations){
      if(store!=='all'&&store!==location.name)continue;
      const meter=isMeterUnit(item.uom);
      const qty=location.stock;
      const low=cat==='materials'&&meter&&typeof qty==='number'&&qty>=0&&qty<LOW_MATERIAL_METERS;
      const negative=typeof qty==='number'&&qty<0;
      if(category==='low'&&!low||category==='negative'&&!negative)continue;
      if(!['all','low','negative'].includes(category)&&cat!==category)continue;
      out.push({
        name:item.name||null,code:item.code||null,uom:item.uom||null,
        catalogPath:item.catalogPath||null,category:cat,warehouse:location.name,
        stock:qty,reserve:location.reserve,inTransit:location.inTransit,
        low,negative,meter
      });
    }
  }
  return out;
}
export function summarizeInventory(items,loaded,expected){
  if(!Array.isArray(items)||!Number.isSafeInteger(loaded)||loaded!==items.length||
    !Number.isSafeInteger(expected)||expected<loaded)throw Error('inventory_summary_unverified');
  const rows=inventoryRows(items);
  const categories={materials:0,cut:0,finished:0,covers:0,doorCards:0,unverified:0};
  let productionItems=0;
  for(const item of items){
    const category=classifyInventory(item);
    if(category==='excluded')continue;
    categories[category]++;
    productionItems++;
  }
  const counts={low:0,negative:0,unknownStock:0,meterRows:0};
  const warehouses=new Set();
  for(const row of rows){
    if(row.warehouse!=='Склад не указан')warehouses.add(row.warehouse);
    if(row.low)counts.low++;
    if(row.negative)counts.negative++;
    if(row.stock===null)counts.unknownStock++;
    if(row.meter)counts.meterRows++;
  }
  return {loaded,expected,complete:loaded===expected,productionItems,
    // Non-production inventory is intentionally excluded from the dashboard.
    hiddenOtherItems:loaded-productionItems,
    categories,counts,warehouses:[...warehouses].sort((a,b)=>a.localeCompare(b,'ru')),
    // Never add up quantities across different units or call page data full stock.
    visibleStoreRows:rows.length,scope:'LOADED_ASSORTMENT_ROWS_NOT_PHYSICAL_INVENTORY'};
}
export function unitTotals(rows){
  if(!Array.isArray(rows))throw Error('inventory_invalid_rows');
  const grouped=new Map();
  for(const row of rows){
    if(typeof row?.stock!=='number'||!Number.isFinite(row.stock)||!validStr(row.uom,50))continue;
    const unit=norm(row.uom);
    grouped.set(unit,(grouped.get(unit)||0)+row.stock);
  }
  return [...grouped].sort(([a],[b])=>a.localeCompare(b,'ru'));
}
