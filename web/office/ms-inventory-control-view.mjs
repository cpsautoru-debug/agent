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
export function classifyInventory(item){
  const path=item?.catalogPath;
  if(classifyCatalogPath(path)==='MATERIAL_FOLDER_EVIDENCE')return 'materials';
  if(typeof path!=='string'||path.length>180||
    /[\u0000-\u001f\u007f]/u.test(path))return 'unverified';
  const parts=path.split(SPLIT).map(norm);
  if(parts.some(x=>!x))return 'unverified';
  if(parts.some(x=>cutNames.has(x)))return 'cut';
  if(parts.some(x=>finishedNames.has(x)))return 'finished';
  return 'unverified';
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
    !['all','materials','cut','finished','unverified','low','negative'].includes(category))
    throw Error('inventory_filters_invalid');
  const search=norm(query);
  const out=[];
  for(const item of items){
    const cat=classifyInventory(item);
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
      const low=meter&&typeof qty==='number'&&qty>=0&&qty<LOW_MATERIAL_METERS;
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
  const categories={materials:0,cut:0,finished:0,unverified:0};
  for(const item of items)categories[classifyInventory(item)]++;
  const counts={low:0,negative:0,unknownStock:0,meterRows:0};
  const warehouses=new Set();
  for(const row of rows){
    if(row.warehouse!=='Склад не указан')warehouses.add(row.warehouse);
    if(row.low)counts.low++;
    if(row.negative)counts.negative++;
    if(row.stock===null)counts.unknownStock++;
    if(row.meter)counts.meterRows++;
  }
  return {loaded,expected,complete:loaded===expected,
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
