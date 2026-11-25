import {verifySession} from '../auth/session.js';
import {classifyOrderBucket} from './order-buckets.js';
import {projectOrderLine} from './order-availability.js';
import {readWarehouse} from './fulfillment-warehouse.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/order-stock-precheck';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROOT='https://api.moysklad.ru/api/remap/1.2/';
const TYPES=['product','variant','bundle'];
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
  let order,items;
  try{
   order=await db.prepare(
    'SELECT order_key,source,account,source_status,source_checked_at,items_json,ms_customerorder_id FROM office_order_queue WHERE order_key=? LIMIT 1')
    .bind(key).first();
   if(!order)return response(404,{code:'order_not_found'});
   if(classifyOrderBucket(order).bucket!=='active')
    return response(409,{code:'order_not_active',changedRecords:0});
   const stamp=Date.parse(order.source_checked_at);
   if(!Number.isFinite(stamp)||Date.now()-stamp>86400000||
      stamp>Date.now()+300000)
    return response(409,{code:'source_snapshot_stale',changedRecords:0});
   items=JSON.parse(order.items_json);
   if(!Array.isArray(items)||items.length<1||items.length>8)throw Error();
  }catch{return response(503,{code:'order_data_unverified',changedRecords:0});}
  const checkedAt=new Date().toISOString();
  let warehouse={status:'warehouse_unverified'};
  let warehouseSaved=false;
  try{
   const mapping=await db.prepare(
    'SELECT store_id,organization_id,store_kind FROM office_order_warehouse_routes WHERE source=? AND seller_account=?')
    .bind(order.source,order.account).first();
   const token=env.MS_API_TOKEN;
   warehouse=await readWarehouse(order,mapping,async path=>{
    if(typeof token!=='string'||!token||/\s/.test(token))throw Error();
    const result=await fetcher(ROOT+'entity/'+path,{method:'GET',redirect:'manual',
     headers:{Authorization:'Bearer '+token,Accept:'application/json'},
     signal:AbortSignal.timeout(8000)});
    if(result.status!==200){
     await result.body?.cancel().catch(()=>{});
     throw Error();
    }
    return result.json();
   });
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
  for(const item of items){
   const ordered=item.quantity;
   if(!Number.isFinite(ordered)||ordered<=0)
    return response(503,{code:'invalid_order_quantity',changedRecords:0});
   let id=null,type=null;
   if(['avito','plamya','dealer_ruslan','dealer_irina'].includes(order.source)){
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
   const projection=projectOrderLine({ordered,orderActive:true,itemConfirmed:!!id,
    storeConfirmed:warehouse.status==='warehouse_verified'});
   const entry={item:label,ordered,itemId:id,itemType:type,
    stores:[],stockEvidence:'not_verified',projection};
   if(id&&typeof env.MS_API_TOKEN==='string'&&env.MS_API_TOKEN&&!/\s/.test(env.MS_API_TOKEN)){
    try{
     const u=new URL(ROOT+'report/stock/bystore');
     u.searchParams.set('filter','assortment='+ROOT+'entity/'+type+'/'+id);
     u.searchParams.set('limit','2');
     const r=await fetcher(u.toString(),{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
       Accept:'application/json;charset=utf-8'},signal:AbortSignal.timeout(15000)});
     if(r.status===200){
      const raw=await r.text();
      if(raw.length>240000)throw Error();
      const data=JSON.parse(raw);
      if(data?.meta?.size!==1||data.rows?.length!==1)throw Error();
      entry.stores=validateStockRow(data.rows[0],type,id);
      entry.stockEvidence='report_by_store';
     }else{
      await r.body?.cancel().catch(()=>{});
      entry.stockReason=r.status===429?'rate_limited':'stock_report_unavailable';
     }
    }catch{entry.stockReason='stock_report_unverified';}
   }
   rows.push(entry);
  }
  return response(200,{code:'order_stock_precheck',readOnly:!warehouseSaved,
   changedRecords:warehouseSaved?1:0,changedMoySkladRecords:0,orderKey:key,rows,
   warehouse:{...warehouse,checkedAt:warehouseSaved?checkedAt:null},
   completeness:'NOT_READY_FOR_ALLOCATION',sewingAllowed:false,
   note:'Stock by store remains informational until complete allocation and production evidence is available.'});
 };
}
export const onRequestPost=createStockPrecheck();
