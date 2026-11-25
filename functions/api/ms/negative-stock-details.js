import {verifySession} from '../auth/session.js';

// Exact negative-stock identities + names, two warehouses are not assumed.
// Read-only historical snapshot of non-atomic MoySklad report pages.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/negative-stock-details';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const headers={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const name=s=>typeof s==='string'&&s.length<=180&&
 !/[\u0000-\u001f\u007f]/.test(s)?s:null;
function identity(raw){
 if(typeof raw!=='string'||raw.length>420)return null;
 try{
  const url=new URL(raw);
  const match=/^\/api\/remap\/1\.2\/entity\/(product|variant)\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if(url.origin!=='https://api.moysklad.ru'||!match||!UUID.test(match[2]))return null;
  return match[2].toLowerCase();
 }catch{return null;}
}
async function get(fetcher,token,path){
 let result;
 try{result=await fetcher(BASE+path,{
  method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(15000)})}catch{return {error:'upstream_timeout'};}
 if(result.status!==200){
  await result.body?.cancel().catch(()=>{});
  return {error:result.status===429?'rate_limited':
   result.status===401?'token_rejected':
   result.status===403?'permission_denied':'upstream_http_'+result.status};
 }
 try{
  const text=await result.text();
  if(text.length>550000)return {error:'response_too_large'};
  const obj=JSON.parse(text);
  if(!Number.isSafeInteger(obj?.meta?.size)||!Array.isArray(obj?.rows))
   return {error:'invalid_collection'};
  return {value:obj};
 }catch{return {error:'invalid_response'};}
}
export function createNegativeStockDetails({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return response(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url)}catch{return response(400,{code:'bad_url'})}
  const keys=[...u.searchParams.keys()];
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.hash||
   keys.some(k=>k!=='utm_source')||u.searchParams.getAll('utm_source').length>1)
   return response(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
    !env.OZON_FINANCE_DB)return response(503,{code:'owner_auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET)}
  catch{return response(401,{code:'owner_session_required'})}
  if(!sub)return response(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return response(403,{code:'owner_only'});
  }catch{return response(503,{code:'owner_auth_unavailable'})}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))
   return response(503,{code:'ms_token_unavailable'});
  const token=env.MS_API_TOKEN;
  let total=null;let scanned=0;const negatives=[],ids=new Set();
  for(let offset=0;offset<800;offset+=100){
   const part=await get(fetcher,token,
    'report/stock/bystore?limit=100&offset='+offset+'&groupBy=variant');
   if(part.error)return response(200,{code:'ms_negative_stock_audit_incomplete',
    readOnly:true,changedRecords:0,reason:part.error,
    positionsRead:scanned,expected:total});
   const data=part.value;
   if(total===null)total=data.meta.size;
   if(data.meta.size!==total||data.rows.length>100||
      (offset<total&&!data.rows.length))
    return response(200,{code:'ms_negative_stock_audit_incomplete',
     readOnly:true,changedRecords:0,reason:'pagination_inconsistent'});
   for(const item of data.rows){
    const id=identity(item.meta?.href);
    if(!Array.isArray(item.stockByStore))
     return response(200,{code:'ms_negative_stock_audit_incomplete',
      readOnly:true,changedRecords:0,reason:'missing_store_breakdown'});
    for(const st of item.stockByStore){
     if(typeof st.stock!=='number'||!Number.isFinite(st.stock))
      continue;
     if(st.stock<0){
      const entry={id,warehouse:name(st.name),
       stock:st.stock,reserve:typeof st.reserve==='number'?st.reserve:null,
       itemName:name(item.name),itemCode:name(item.code),
       unit:name(item.uom?.name),catalogPath:null};
      negatives.push(entry);
      if(id)ids.add(id);
     }
    }
   }
   scanned+=data.rows.length;
   if(scanned>=total)break;
  }
  if(scanned!==total)return response(200,{
   code:'ms_negative_stock_audit_incomplete',reason:'scan_limit',
   readOnly:true,changedRecords:0,positionsRead:scanned,expected:total});
  const names=new Map();
  const allIds=[...ids];
  let metadataComplete=true,lookupError=null;
  for(let i=0;i<allIds.length;i+=10){
   const batch=allIds.slice(i,i+10);
   const lookup=new URL(BASE+'entity/assortment');
   lookup.searchParams.set('limit','10');
   lookup.searchParams.set('filter',batch.map(id=>'id='+id).join(';'));
   // Units of measure are normally an expanded reference, not embedded.
   // Fallback only if this API account rejects expand=uom (HTTP 400).
   const expanded=new URL(lookup);
   expanded.searchParams.set('expand','uom');
   let answer=await get(fetcher,token,expanded.toString().slice(BASE.length));
   if(answer.error==='upstream_http_400')
    answer=await get(fetcher,token,lookup.toString().slice(BASE.length));
   if(answer.error){
    metadataComplete=false;lookupError=answer.error;break;
   }
   for(const item of answer.value.rows){
    if(UUID.test(item.id||'')&&batch.includes(item.id.toLowerCase()))
     names.set(item.id.toLowerCase(),{
      itemName:name(item.name),itemCode:name(item.code),
      unit:name(item.uom?.name)||name(item.uomName),
      catalogPath:name(item.pathName)});
   }
  }
  for(const item of negatives){
   const resolved=item.id?names.get(item.id):null;
   if(resolved)Object.assign(item,resolved);
  }
  negatives.sort((a,b)=>a.stock-b.stock);
  return response(200,{code:'ms_negative_stock_details',
   readOnly:true,changedRecords:0,checkedAt:new Date().toISOString(),
   positionsRead:scanned,completeReportPages:true,
   negativeLines:negatives.length,distinctNegativeItems:ids.size,
   metadataComplete:metadataComplete&&names.size===ids.size,
   resolvedItemNames:negatives.filter(x=>x.itemName).length,
   lookupError,items:negatives,
   caveat:'Non-atomic stock report. Stock unit belongs to assortment, not inferred from quantity. No mutations performed.'});
 };
}
export const onRequestGet=createNegativeStockDetails();
