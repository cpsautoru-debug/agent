const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const blocked={status:'availability_unverified'};
const ROOT='https://api.moysklad.ru/api/remap/1.2/';

function matchesEntity(href,expected){
 try{
  const url=new URL(href);
  return !url.username&&!url.password&&!url.hash&&url.origin+url.pathname===expected;
 }catch{return false;}
}

export async function readExpandedStock(type,itemId,storeId,read){
 if(!['product','variant'].includes(type)||!ID.test(itemId)||!ID.test(storeId))return blocked;
 const item=ROOT+'entity/'+type+'/'+itemId;
 const store=ROOT+'entity/store/'+storeId;
 const query=new URLSearchParams({filter:type+'='+item+';store='+store+';stockMode=all',limit:'2'});
 try{
  const data=await read('report/stock/bystore?'+query);
  const row=data?.rows?.[0];
  if(data?.meta?.size!==1||data.meta.nextHref||data.rows.length!==1||
     !matchesEntity(row?.meta?.href,item)||!Array.isArray(row.stockByStore))return blocked;
  const matches=row.stockByStore.filter(value=>matchesEntity(value?.meta?.href,store));
  if(matches.length!==1)return blocked;
  const {stock,reserve}=matches[0];
  if(!Number.isFinite(stock)||!Number.isFinite(reserve)||reserve<0)return blocked;
  return {status:'accounting_verified',stock,reserve,report:'expanded_exact'};
 }catch{return blocked;}
}

function quantityAt(rows,itemId,storeId,field){
 if(!Array.isArray(rows)||!rows.length||rows.length>200)throw Error();
 const stores=new Set();
 let quantity;
 for(const row of rows){
  if(row?.assortmentId!==itemId||
   (row.storeId!==null&&!ID.test(row.storeId||''))||stores.has(row.storeId)||
   !Number.isFinite(row[field])||Math.abs(row[field])>1e8)throw Error();
  stores.add(row.storeId);
  if(field==='reserve'&&(row[field]<0||(row.storeId===null&&row[field]>0)))throw Error();
  if(row.storeId===storeId)quantity=row[field];
 }
 if(quantity===undefined)throw Error();
 return quantity;
}

export async function readStock(itemId,storeId,read){
 if(!ID.test(itemId||'')||!ID.test(storeId||''))return blocked;
 try{
  const readType=async field=>{
   const query=new URLSearchParams({stockType:field,filter:'assortmentId='+itemId,
    include:'zeroLines',withRecalculate:'true'});
   return quantityAt(await read('report/stock/bystore/current?'+query),itemId,storeId,field);
  };
  const [stock,reserve,free]=await Promise.all(['stock','reserve','freeStock'].map(readType));
  if(Math.abs(stock-reserve-free)>1e-8)return blocked;
  return {status:'accounting_verified',stock,reserve};
 }catch{return blocked;}
}

// The cohort must cover all competing claims for this item and warehouse.
// Reserve is reconciled to position evidence before allocating free units.
export function allocateStock(balance,lines,complete){
 if(!complete||balance.status!=='accounting_verified'||balance.stock<balance.reserve||
  new Set(lines.map(line=>line.key)).size!==lines.length||
  lines.some(({ordered,reserved})=>!Number.isSafeInteger(ordered)||ordered<=0||
   !Number.isSafeInteger(reserved)||reserved<0||reserved>ordered)||
  lines.reduce((sum,line)=>sum+line.reserved,0)!==balance.reserve)return null;
 let free=Math.floor(balance.stock-balance.reserve);
 return lines.map(({key,ordered,reserved})=>{
  const unreserved=Math.min(ordered-reserved,free);
  free-=unreserved;
  return {key,reserved,unreserved,covered:reserved+unreserved,missing:ordered-reserved-unreserved};
 });
}
