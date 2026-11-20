// Pure, local-only view selectors. The stock report itself remains one API page.
// Filters never imply a full warehouse balance or trigger more network requests.
export function pageWarehouseNames(items){
  if(!Array.isArray(items))throw Error('invalid_stock_page');
  const names=new Set();
  for(const item of items){
    if(!Array.isArray(item?.stores))throw Error('invalid_stock_page');
    for(const store of item.stores){
      if(typeof store?.name!=='string'||!store.name.trim())
        throw Error('invalid_stock_page');
      names.add(store.name);
    }
  }
  return [...names];
}
export function selectStockPageGroups(items,warehouse=''){
  if(typeof warehouse!=='string'||!Array.isArray(items))
    throw Error('invalid_stock_page_filter');
  return items.flatMap(item=>{
    if(!Array.isArray(item?.stores))throw Error('invalid_stock_page');
    if(warehouse==='')return [{...item,stores:item.stores}];
    const matching=item.stores.filter(store=>store.name===warehouse);
    return matching.length?[{...item,stores:matching}]:[];
  });
}
export function summarizeStockPageGroups(groups){
  if(!Array.isArray(groups))throw Error('invalid_stock_page');
  let negative=0,unknown=0,zero=0,positions=0,visibleStoreRows=0;
  for(const group of groups){
    positions++;
    if(!Array.isArray(group?.stores))throw Error('invalid_stock_page');
    if(group.stores.length===0){unknown++;continue;}
    for(const store of group.stores){
      visibleStoreRows++;
      if(typeof store.stock!=='number'||!Number.isFinite(store.stock))unknown++;
      else if(store.stock<0)negative++;
      else if(store.stock===0)zero++;
    }
  }
  return {positions,negative,unknown,zero,visibleStoreRows};
}
