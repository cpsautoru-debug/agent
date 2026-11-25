import {verifySession} from '../auth/session.js';

// Owner-only SKU crosswalk. Writes ONLY the separate office D1 mapping table.
// No writes to MoySklad, orders, stock, production or finance.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/order-sku-links';
const MS='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const text=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n&&
 x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const sources=['ozon','ozon_fbo','wb','yandex'];
const types=['product','variant','bundle'];
const SQL_READ='SELECT source,seller_account,marketplace_sku,ms_item_type,ms_item_id,ms_item_name,approved_at FROM office_order_sku_links ORDER BY approved_at DESC LIMIT 200';
const SQL_FIND='SELECT ms_item_id,ms_item_type FROM office_order_sku_links WHERE source=? AND seller_account=? AND marketplace_sku=? LIMIT 1';
const SQL_ADD='INSERT INTO office_order_sku_links (source,seller_account,marketplace_sku,ms_item_type,ms_item_id,ms_item_name,evidence,approved_by_sub) VALUES (?,?,?,?,?,?,?,?)';
async function ownerCheck(request,env){
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
  return {status:503,code:'owner_auth_unavailable'};
 const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
 if(!sub)return {status:401,code:'owner_session_required'};
 try{
  const o=await env.OZON_FINANCE_DB.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
   .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
  return o?.allowed===1?{sub}:{status:403,code:'owner_only'};
 }catch{return {status:503,code:'owner_auth_unavailable'};}
}
export function validSkuLink(i){
 return i&&typeof i==='object'&&
  Object.keys(i).sort().join(',')==='itemId,itemType,sellerAccount,sku,source'&&
  sources.includes(i.source)&&text(i.sellerAccount,100)&&
  /^[A-Za-z0-9._:-]{1,100}$/.test(i.sellerAccount)&&
  text(i.sku,100)&&types.includes(i.itemType)&&
  typeof i.itemId==='string'&&UUID.test(i.itemId);
}
export function createSkuLinkHandler({fetcher=fetch}={}){
 return async({request,env})=>{
  if(!['GET','POST'].includes(request.method))return json(405,{code:'method_not_allowed'});
  const u=new URL(request.url);
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.search||u.hash)
   return json(400,{code:'invalid_scope'});
  const auth=await ownerCheck(request,env);
  if(!auth.sub)return json(auth.status,{code:auth.code});
  const db=env.OZON_FINANCE_DB;
  if(request.method==='GET'){
   try{
    const rows=(await db.prepare(SQL_READ).all()).results;
    if(!Array.isArray(rows))throw Error();
    return json(200,{code:'sku_links_read',readOnly:true,changedRecords:0,
     approvedLinks:rows,hasMore:rows.length===200,
     note:'Owner-approved mappings only; not inventory or shipment approval.'});
   }catch{return json(503,{code:'sku_links_storage_unavailable',
    action:'apply_migration_20261125_order_sku_links'});}
  }
  if(request.headers.get('Origin')!==ORIGIN||
     request.headers.get('Sec-Fetch-Site')==='cross-site')
   return json(403,{code:'origin_not_allowed'});
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
   return json(503,{code:'ms_token_unavailable'});
  let payload;
  try{
   if(Number(request.headers.get('content-length'))>1800)throw Error();
   payload=await request.json();if(!validSkuLink(payload))throw Error();
  }catch{return json(400,{code:'invalid_link'});}
  // Never silently replace an existing owner-approved mapping.
  try{
   const old=await db.prepare(SQL_FIND)
    .bind(payload.source,payload.sellerAccount,payload.sku).first();
   if(old)return json(409,{code:'sku_link_already_exists',same:
    old.ms_item_id===payload.itemId.toLowerCase()&&old.ms_item_type===payload.itemType});
  }catch{return json(503,{code:'sku_links_storage_unavailable'});}
  // Verify product identity exists, without treating fuzzy suggestions as proof.
  let item;
  try{
   const response=await fetcher(MS+payload.itemType+'/'+payload.itemId,{
    method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
    Accept:'application/json;charset=utf-8'},signal:AbortSignal.timeout(12000)});
   if(response.status!==200){
    await response.body?.cancel().catch(()=>{});
    return json(502,{code:response.status===429?'ms_rate_limited':'ms_item_unverified'});
   }
   const raw=await response.text();
   if(raw.length>120000)throw Error();
   item=JSON.parse(raw);
   if(String(item.id||'').toLowerCase()!==payload.itemId.toLowerCase()||
    !text(item.name,200))throw Error();
  }catch{return json(502,{code:'ms_item_unverified'});}
  try{
   await db.prepare(SQL_ADD).bind(payload.source,payload.sellerAccount,payload.sku,
    payload.itemType,payload.itemId.toLowerCase(),item.name,
    'owner_selected_verified_id',auth.sub).run();
   return json(201,{code:'sku_link_approved',changedRecords:1,writeScope:'OFFICE_D1_ONLY',
    source:payload.source,sellerAccount:payload.sellerAccount,sku:payload.sku,
    itemId:payload.itemId.toLowerCase(),itemName:item.name,
    note:'Mapping approved by owner; stock, customer orders and MoySklad unchanged.'});
  }catch{return json(503,{code:'sku_link_conflict_or_storage_unavailable'});}
 };
}
export const onRequest=createSkuLinkHandler();
