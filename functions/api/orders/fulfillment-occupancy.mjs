const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const quantity=value=>Number.isSafeInteger(value)&&value>=0;

export async function readCompletePages(read,path,{limit=50,maxPages=4}={}){
 const rows=[];
 const ids=new Set();
 let size;
 for(let page=0;page<maxPages;page++){
  const query=new URL(path,'https://local.invalid/');
  query.searchParams.set('limit',limit);
  query.searchParams.set('offset',page*limit);
  const data=await read(query.pathname.slice(1)+query.search);
  if(!Number.isSafeInteger(data?.meta?.size)||data.meta.size<0||
     (size!==undefined&&size!==data.meta.size)||
     (data.meta.offset!==undefined&&data.meta.offset!==page*limit)||
     !Array.isArray(data.rows))throw Error('invalid_page');
  size=data.meta.size;
  if(size>limit*maxPages||data.rows.length!==Math.min(limit,size-rows.length))
   throw Error('incomplete_page');
  for(const row of data.rows){
   if(!UUID.test(row?.id||'')||ids.has(row.id))throw Error('duplicate_or_invalid_row');
   ids.add(row.id);
   rows.push(row);
  }
  if(rows.length===size){
   if(data.meta.nextHref)throw Error('unexpected_next_page');
   return rows;
  }
 }
 throw Error('page_limit');
}

function matchItem(position,type,itemId){
 try{
  const url=new URL(position?.assortment?.meta?.href);
  const identity=url.origin+url.pathname;
  if(!/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/(product|variant|bundle|service|consignment)\/[a-f0-9-]{36}$/.test(identity))
   throw Error();
  return identity===ROOT+type+'/'+itemId;
 }catch{throw Error('position_identity_unverified');}
}

export async function readOccupancy(type,itemId,storeId,balance,read){
 if(!UUID.test(itemId||'')||!UUID.test(storeId||'')||balance?.status!=='accounting_verified')
  return {status:'availability_unverified',reason:'stock_unverified'};
 let stage='warehouse_orders';
 try{
  const store=ROOT+'store/'+storeId;
  const filters=new URLSearchParams({filter:'store='+store,expand:'state'});
  const orders=await readCompletePages(read,'entity/customerorder?'+filters);
  let reserve=0, additional=0, matchingOrders=0;
  for(const order of orders){
   stage='order_state';
   if(order.store?.meta?.href!==store||typeof order.applicable!=='boolean')throw Error();
   if(order.applicable===false)continue;
   const state=order.state?.stateType;
   if(!['Regular','Successful','Unsuccessful'].includes(state))throw Error();
   stage='order_positions';
   const positions=await readCompletePages(read,'entity/customerorder/'+order.id+'/positions');
   const matches=positions.filter(position=>matchItem(position,type,itemId));
   if(matches.length)matchingOrders++;
   for(const position of matches){
    const {quantity:ordered,shipped,reserve:reserved}=position;
    if(!quantity(ordered)||!quantity(shipped)||!quantity(reserved)||shipped>ordered||
       reserved>ordered-shipped)throw Error();
    if(state!=='Regular'){
     if(reserved!==0)throw Error();
     continue;
    }
    reserve+=reserved;
    additional+=ordered-shipped-reserved;
   }
  }
  if(reserve!==balance.reserve)return {status:'availability_unverified',reason:'reserve_mismatch',
   ordersSeen:orders.length,matchingOrders};
  // This proves the scope of the warehouse customer orders only. Marketplace
  // promises that have no customerorder document still require reconciliation.
  return {status:'warehouse_orders_verified',ordersSeen:orders.length,matchingOrders,
   reconciledReserve:reserve,warehouseAdditional:additional};
 }catch{return {status:'availability_unverified',reason:stage+'_unverified'};}
}
