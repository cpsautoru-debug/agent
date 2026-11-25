import {verifySession} from '../auth/session.js';
import {readStock} from '../orders/fulfillment-stock.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/approved-sku-stock-current';
const ROOT='https://api.moysklad.ru/api/remap/1.2/';
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export function createApprovedStockCurrent({fetcher=fetch}={}){
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
   const owner=await db.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
    .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return response(403,{code:'owner_only'});
  }catch{return response(503,{code:'auth_unavailable'});}
  let body;
  try{
   if(Number(request.headers.get('Content-Length'))>600)throw Error();
   body=await request.json();
   if(!body||Object.keys(body).sort().join(',')!=='sellerAccount,sku,source'||
    !['ozon','wb','yandex'].includes(body.source)||
    !/^[A-Za-z0-9._:-]{1,100}$/.test(body.sellerAccount)||
    typeof body.sku!=='string'||!body.sku||
    body.sku.length>100||body.sku.trim()!==body.sku)throw Error();
  }catch{return response(400,{code:'invalid_sku'});}
  let approved,route;
  try{
   [approved,route]=await Promise.all([
    db.prepare('SELECT ms_item_id,ms_item_type,ms_item_name FROM office_order_sku_links WHERE source=? AND seller_account=? AND marketplace_sku=? LIMIT 1')
     .bind(body.source,body.sellerAccount,body.sku).first(),
    db.prepare('SELECT store_id,organization_id,store_kind FROM office_order_warehouse_routes WHERE source=? AND seller_account=? LIMIT 1')
     .bind(body.source,body.sellerAccount).first()
   ]);
  }catch{return response(503,{code:'mapping_storage_unavailable'});}
  if(!approved||!route)return response(409,{code:'approved_item_or_warehouse_missing'});
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
   return response(503,{code:'ms_token_unavailable'});
  let verifiedStore=false,verifiedItem=false;
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(!uuid.test(approved.ms_item_id)||!uuid.test(route.store_id)||
    !['product','variant','bundle'].includes(approved.ms_item_type))
   return response(409,{code:'unverified_mapping_uuid'});
  async function boundedFetch(path){
   const res=await fetcher(ROOT+path,{method:'GET',redirect:'manual',
    headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
     Accept:'application/json;charset=utf-8'},
    signal:AbortSignal.timeout(12000)});
   if(res.status!==200){await res.body?.cancel().catch(()=>{});
    throw Error(res.status===429?'rate_limited':'upstream_'+res.status);}
   const raw=await res.text();if(raw.length>250000)throw Error('response_too_large');
   return JSON.parse(raw);
  }
  try{
   const [item,store]=await Promise.all([
    boundedFetch('entity/'+approved.ms_item_type+'/'+approved.ms_item_id),
    boundedFetch('entity/store/'+route.store_id)
   ]);
   verifiedItem=String(item?.id||'').toLowerCase()===approved.ms_item_id.toLowerCase()&&
     item.archived!==true;
   verifiedStore=String(store?.id||'').toLowerCase()===route.store_id.toLowerCase()&&
     store.archived!==true;
  }catch{return response(200,{code:'stock_current_unverified',
   status:'identity_unverified',readOnly:true,changedRecords:0,stock:null,reserve:null});}
  if(!verifiedItem||!verifiedStore)return response(409,{code:'item_or_store_unverified'});
  let calls=0;
  const read=async path=>{
   if(++calls>3||!path.startsWith('report/stock/bystore/current?'))
    throw Error('read_scope_invalid');
   return boundedFetch(path);
  };
  const values=await readStock(approved.ms_item_id.toLowerCase(),
    route.store_id.toLowerCase(),read);
  if(values.status!=='accounting_verified')
   return response(200,{code:'stock_current_unverified',status:'availability_unverified',
    readOnly:true,changedRecords:0,itemId:approved.ms_item_id,
    storeId:route.store_id,stock:null,reserve:null,
    note:'Current report missing, filtered or inconsistent; no quantities established.'});
  return response(200,{code:'approved_stock_current',readOnly:true,changedRecords:0,
   source:body.source,sellerAccount:body.sellerAccount,sku:body.sku,
   itemName:approved.ms_item_name,itemId:approved.ms_item_id,storeId:route.store_id,
   stock:values.stock,reserve:values.reserve,
   accountingFree:values.stock-values.reserve,checkedAt:new Date().toISOString(),
   allocationAllowed:false,sewingAllowed:false,
   note:'Accounting stock minus reserve only. Competing-order allocations and physical availability unverified.'});
 };
}
export const onRequestPost=createApprovedStockCurrent();
