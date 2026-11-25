import {verifySession} from '../auth/session.js';
// Detect existing custom "Канал продаж" customer-order field without modifying it.
const PATH='/api/ms/manual-channel-field';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const SRC='https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/attributes';
const reply=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export function createChannelFieldDiscovery({fetcher=fetch}={}){
 return async({request,env})=>{
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  const u=new URL(request.url);
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.search||u.hash)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
     !env.OZON_FINANCE_DB)return reply(503,{code:'owner_auth_unavailable'});
  const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
  if(!sub)return reply(401,{code:'owner_session_required'});
  try{
   const row=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
    .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(row?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'owner_auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
   return reply(503,{code:'ms_token_unavailable'});
  try{
   const response=await fetcher(SRC,{method:'GET',redirect:'manual',
    headers:{Authorization:'Bearer '+env.MS_API_TOKEN,Accept:'application/json;charset=utf-8'},
    signal:AbortSignal.timeout(15000)});
   if(response.status!==200){
    await response.body?.cancel().catch(()=>{});
    return reply(502,{code:'ms_channel_metadata_unavailable',upstreamHttp:response.status});
   }
   const raw=await response.text();
   if(raw.length>100000)throw Error('too_large');
   const body=JSON.parse(raw);
   const rows=Array.isArray(body?.rows)?body.rows:Array.isArray(body)?body:null;
   if(!rows||rows.length>100)throw Error('invalid_response');
   const fields=rows.filter(x=>x?.name==='Канал продаж');
   if(fields.length>1)throw Error('ambiguous_field');
   const field=fields[0];
   const type=typeof field?.type==='string'?field.type:null;
   return reply(200,{code:'ms_manual_channel_field_discovery',readOnly:true,
    changedRecords:0,exists:fields.length===1,
    fieldType:type,fieldId:fields.length===1&&typeof field.id==='string'?field.id:null,
    supportedForAutomaticImport:false,
    note:'Only discovery. No channel inferred from customer name. Existing externalCode markers remain active.'});
  }catch{return reply(502,{code:'ms_channel_metadata_unverified',readOnly:true,changedRecords:0});}
 };
}
export const onRequestGet=createChannelFieldDiscovery();
