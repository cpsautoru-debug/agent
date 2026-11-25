import {verifySession} from '../auth/session.js';
import {classifyOrderBucket} from './order-buckets.js';
import {projectOrderLine} from './order-availability.js';
import {readWarehouse} from './fulfillment-warehouse.mjs';
import {readStock,readExpandedStock} from './fulfillment-stock.mjs';
import {readProduction} from './fulfillment-production.mjs';
import {readOccupancy} from './fulfillment-occupancy.mjs';
import {buildReview,saveReview} from './fulfillment-review.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/order-stock-precheck';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROOT='https://api.moysklad.ru/api/remap/1.2/';
const TYPES=['product','variant','bundle'];
const MANUAL=['avito','plamya','dealer_ruslan','dealer_irina'];
const response=(status,x)=>new Response(JSON.stringify(x),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export function validateStockRow(row,type,id){
 if(!row||row.meta?.href!==ROOT+'entity/'+type+'/'+id||
   !Array.isArray(row.stockByStore)||row.stockByStore.length>50)throw Error('stock_row_unverified');
 const stores=[];
 for(const s of row.stockByStore){
  if(typeof s?.name!=='string'||s.name.length>120||!Number.isFinite(s.stock)||
   !Number.isFinite(s.reserve))throw Error('stock_row_unverified');
  stores.push({store:s.name,accountingStock:s.stock,
   reserve:s.reserve,accountingFree:s.stock-s.reserve});
 }
 return stores;
}
export function createStockPrecheck({fetcher=fetch}={}){
 return async({request,env})=>{
  if(request.method!=='POST')return response(405,{code:'method_not_allowed'});
  const url=new URL(request.url);
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.search||url.hash)
   return response(400,{code:'invalid_scope'});
  if(request.headers.get('Origin')!==ORIGIN||
   request.headers.get('Sec-Fetch-Site')==='cross-site')
   return response(403,{code:'origin_not_allowed'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return response(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return response(401,{code:'owner_session_required'});
  const db=env.OZON_FINANCE_DB;
  try{
   const x=await db.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
    .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(x?.allowed!==1)return response(403,{code:'owner_only'});
  }catch{return response(503,{code:'auth_unavailable'});}
  let key;
  try{
   const b=await request.json();
   if(!b||Object.keys(b).join(',')!=='orderKey'||typeof b.orderKey!=='string'||
    b.orderKey.length>180||!b.orderKey.startsWith('AS63:'))throw Error();
   key=b.orderKey;
  }catch{return response(400,{code:'invalid_order_key'});}
  let order,items,active;
  try{
   order=await db.prepare(
    'SELECT order_key,source,account,source_status,production_disposition,source_checked_at,items_json,ms_customerorder_id FROM office_order_queue WHERE order_key=? LIMIT 1')
    .bind(key).first();
   if(!order)return response(404,{code:'order_not_found'});
   active=classifyOrderBucket(order).bucket==='active';
   if(!active&&!(MANUAL.includes(order.source)&&order.ms_customerorder_id&&
      order.production_disposition!=='not_for_sewing'))
    return response(409,{code:'order_not_active',changedRecords:0});
   const stamp=Date.parse(order.source_checked_at);
   if(!Number.isFinite(stamp)||Date.now()-stamp>86400000||
      stamp>Date.now()+300000)
    return response(409,{code:'source_snapshot_stale',changedRecords:0});
   // A previously active order is not current if the latest complete source
   // snapshot no longer contains it. Never use historical rows for allocation.
   const sync=await db.prepare(
    'SELECT last_success_at FROM office_order_queue_sync WHERE source=? LIMIT 1')
    .bind(MANUAL.includes(order.source)?'manual':order.source).first();
   if(!sync||sync.last_success_at!==order.source_checked_at)
    return response(409,{code:'order_not_in_latest_snapshot',changedRecords:0});
   items=JSON.parse(order.items_json);
   if(!Array.isArray(items)||items.length<1||items.length>8)throw Error();
  }catch{return response(503,{code:'order_data_unverified',changedRecords:0});}
  const checkedAt=new Date().toISOString();
  const token=env.MS_API_TOKEN;
  let reads=0;
  const read=async path=>{
   if(typeof token!=='string'||!token||/\s/.test(token)||++reads>40||
      Date.now()-Date.parse(checkedAt)>30000)throw Error();
   const result=await fetcher(ROOT+path,{method:'GET',redirect:'manual',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    signal:AbortSignal.timeout(8000)});
   const reader=result.body?.getReader();
   if(!reader)throw Error();
   try{
    if(result.status!==200)throw Error();
    let bytes=0,raw='';
    const decoder=new TextDecoder('utf-8',{fatal:true});
    for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     bytes+=value.byteLength;
     if(bytes>512*1024)throw Error();
     raw+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(raw+decoder.decode());
   }finally{await reader.cancel().catch(()=>{});}
  };
  let warehouse={status:'warehouse_unverified'};
  let warehouseSaved=false;
  try{
   const mapping=await db.prepare(
    'SELECT store_id,organization_id,store_kind FROM office_order_warehouse_routes WHERE source=? AND seller_account=?')
    .bind(order.source,order.account).first();
   warehouse=await readWarehouse(order,mapping,path=>read('entity/'+path));
   const saved=await db.prepare(`INSERT INTO office_order_warehouse_checks
    (order_key,evidence_json,checked_at)
    SELECT order_key,?,? FROM office_order_queue WHERE order_key=? AND source_checked_at=?
    ON CONFLICT(order_key) DO UPDATE SET evidence_json=excluded.evidence_json,
     checked_at=excluded.checked_at
    WHERE office_order_warehouse_checks.checked_at<excluded.checked_at`)
    .bind(JSON.stringify(warehouse),checkedAt,key,order.source_checked_at).run();
   warehouseSaved=saved.meta?.changes===1;
  }catch{}
  if(!warehouseSaved)warehouse={status:'warehouse_unverified'};
  const rows=[];
  const evidenceByItem=new Map();
  for(const item of items){
   const ordered=item.quantity;
   if(!Number.isFinite(ordered)||ordered<=0)
    return response(503,{code:'invalid_order_quantity',changedRecords:0});
   let id=null,type=null;
   if(MANUAL.includes(order.source)){
    if(UUID.test(item.itemId||'')&&TYPES.includes(item.itemType)){
     id=item.itemId.toLowerCase();type=item.itemType;
    }
   }else{
    let link;
    try{link=await db.prepare(
     'SELECT ms_item_id,ms_item_type FROM office_order_sku_links WHERE source=? AND seller_account=? AND marketplace_sku=? LIMIT 1')
     .bind(order.source,order.account,item.sku).first();}
    catch{return response(503,{code:'sku_links_unavailable',changedRecords:0});}
    if(link&&UUID.test(link.ms_item_id||'')&&TYPES.includes(link.ms_item_type)){
     id=link.ms_item_id.toLowerCase();type=link.ms_item_type;
    }
   }
   const label=item.sku||item.name||item.itemId||'unknown';
   const projection=projectOrderLine({ordered,orderActive:active,itemConfirmed:!!id,
    storeConfirmed:warehouse.status==='warehouse_verified'});
   const entry={item:label,ordered,itemId:id,itemType:type,
    stores:[],stockEvidence:'not_verified',projection};
   if(active&&id&&warehouse.status==='warehouse_verified'){
    if(!evidenceByItem.has(id)){
     let accounting=await readStock(id,warehouse.storeId,read);
     if(accounting.status!=='accounting_verified')
      accounting=await readExpandedStock(type,id,warehouse.storeId,read);
     const occupancy=await readOccupancy(type,id,warehouse.storeId,accounting,read);
     const production=await readProduction(id,warehouse.storeId,read);
     evidenceByItem.set(id,{accounting,occupancy,production});
    }
    Object.assign(entry,evidenceByItem.get(id));
    if(entry.accounting.status==='accounting_verified'){
     const {stock,reserve}=entry.accounting;
     entry.stores=[{store:warehouse.storeName,accountingStock:stock,reserve,
      accountingFree:stock-reserve}];
     entry.stockEvidence='report_by_store';
    }
   }
   rows.push(entry);
  }
  const review=buildReview(warehouse,rows);
  let reviewChanges=0,reviewStored=false;
  if(active)try{
   const result=await saveReview(db,order,checkedAt,review);
   reviewChanges=result.meta?.changes??0;
   reviewStored=result.success!==false;
  }catch{}
  const changedRecords=Number(warehouseSaved)+reviewChanges;
  return response(200,{code:'order_stock_precheck',readOnly:changedRecords===0,
   changedRecords,changedMoySkladRecords:0,orderKey:key,rows,review,reviewStored,
   warehouse:{...warehouse,checkedAt:warehouseSaved?checkedAt:null},
   completeness:'NOT_READY_FOR_ALLOCATION',sewingAllowed:false,
   note:'Stock by store remains informational until complete allocation and production evidence is available.'});
 };
}
export const onRequestPost=createStockPrecheck();
