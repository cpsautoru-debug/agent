import {verifySession} from '../auth/session.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/warehouse-route-approval';
const BASE='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACC=/^[A-Za-z0-9._:-]{1,100}$/;
const ALLOWED=new Set(['ozon','wb','yandex']);
const KINDS=new Set(['manufacturer','retail','marketplace']);
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
async function getMs(fetcher,token,path){
 const res=await fetcher(BASE+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(15000)});
 if(res.status!==200){await res.body?.cancel().catch(()=>{});throw Error('ms_read_unavailable');}
 const value=await res.text();
 if(value.length>180000)throw Error('ms_response_too_large');
 return JSON.parse(value);
}
async function choices(fetcher,token,entity){
 const data=await getMs(fetcher,token,entity+'?limit=100&offset=0');
 if(!Array.isArray(data.rows)||!Number.isSafeInteger(data.meta?.size)||
    data.meta.size!==data.rows.length||data.rows.length>100)
  throw Error('ms_choices_incomplete');
 if(data.rows.some(x=>!UUID.test(x.id||'')||typeof x.name!=='string'||
    x.name.length>250))throw Error('ms_choices_invalid');
 return data.rows.filter(x=>x.archived!==true).map(x=>({id:x.id.toLowerCase(),name:x.name}));
}
async function verifiedEntity(fetcher,token,type,id){
 const data=await getMs(fetcher,token,type+'/'+id);
 return typeof data.id==='string'&&data.id.toLowerCase()===id&&
  typeof data.name==='string'&&data.name.trim()&&data.archived!==true;
}
export function createWarehouseRouteApproval({fetcher=fetch}={}){
 return async({request,env})=>{
  if(!['GET','POST'].includes(request.method))return reply(405,{code:'method_not_allowed'});
  const url=new URL(request.url);
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.search||url.hash)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return reply(401,{code:'owner_session_required'});
  const db=env.OZON_FINANCE_DB;
  try{
   const row=await db.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
    .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(row?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
   return reply(503,{code:'ms_token_unavailable'});
  if(request.method==='GET'){
   try{
    const [stores,organizations,accounts,routes]=await Promise.all([
     choices(fetcher,env.MS_API_TOKEN,'store'),
     choices(fetcher,env.MS_API_TOKEN,'organization'),
     db.prepare("SELECT DISTINCT source,account FROM office_order_queue WHERE source IN ('ozon','wb','yandex') ORDER BY source,account LIMIT 100").all(),
     db.prepare("SELECT source,seller_account,store_id,organization_id,store_kind FROM office_order_warehouse_routes ORDER BY source,seller_account LIMIT 100").all()
    ]);
    if(!Array.isArray(accounts.results)||!Array.isArray(routes.results))throw Error();
    return reply(200,{code:'warehouse_route_candidates',readOnly:true,
     stores,organizations,accounts:accounts.results,routes:routes.results,
     note:'Owner must select and approve exact store and organization; names are not proof of the marketplace fulfillment contract.'});
   }catch{return reply(503,{code:'warehouse_route_candidates_unavailable',
    note:'MoySklad listing must be complete and D1 schema accessible.'});}
  }
  if(request.headers.get('Origin')!==ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site')
   return reply(403,{code:'origin_not_allowed'});
  let body;
  try{
   if(Number(request.headers.get('Content-Length'))>1000)throw Error();
   body=await request.json();
   if(!body||Object.keys(body).sort().join(',')!==
    'organizationId,sellerAccount,source,storeId,storeKind'||
    !ALLOWED.has(body.source)||!ACC.test(body.sellerAccount)||
    !UUID.test(body.storeId)||!UUID.test(body.organizationId)||
    !KINDS.has(body.storeKind))throw Error();
  }catch{return reply(400,{code:'invalid_route_approval'});}
  const storeId=body.storeId.toLowerCase(),organizationId=body.organizationId.toLowerCase();
  try{
   const account=await db.prepare("SELECT 1 AS present FROM office_order_queue WHERE source=? AND account=? LIMIT 1")
    .bind(body.source,body.sellerAccount).first();
   if(account?.present!==1)return reply(409,{code:'source_account_unverified'});
   const prior=await db.prepare('SELECT store_id,organization_id,store_kind FROM office_order_warehouse_routes WHERE source=? AND seller_account=?')
    .bind(body.source,body.sellerAccount).first();
   if(prior)return reply(409,{code:'warehouse_route_already_confirmed',
    same:prior.store_id===storeId&&prior.organization_id===organizationId&&prior.store_kind===body.storeKind});
  }catch{return reply(503,{code:'route_storage_unavailable'});}
  try{
   const [storeOk,orgOk]=await Promise.all([
    verifiedEntity(fetcher,env.MS_API_TOKEN,'store',storeId),
    verifiedEntity(fetcher,env.MS_API_TOKEN,'organization',organizationId)
   ]);
   if(!storeOk||!orgOk)return reply(409,{code:'ms_entity_unverified'});
  }catch{return reply(503,{code:'ms_entity_check_unavailable'});}
  try{
   const result=await db.prepare(`INSERT INTO office_order_warehouse_routes
    (source,seller_account,store_id,organization_id,store_kind)
    SELECT ?,?,?,?,? WHERE NOT EXISTS
    (SELECT 1 FROM office_order_warehouse_routes WHERE source=? AND seller_account=?)`)
    .bind(body.source,body.sellerAccount,storeId,organizationId,body.storeKind,
     body.source,body.sellerAccount).run();
   if(result?.success===false||result?.meta?.changes!==1)
    return reply(409,{code:'route_concurrent_change'});
   return reply(201,{code:'warehouse_route_approved',changedD1Records:1,
    changedMoySkladRecords:0,source:body.source,sellerAccount:body.sellerAccount,
    storeId,organizationId,storeKind:body.storeKind});
  }catch{return reply(503,{code:'route_storage_unavailable'});}
 };
}
export const onRequest=createWarehouseRouteApproval();
