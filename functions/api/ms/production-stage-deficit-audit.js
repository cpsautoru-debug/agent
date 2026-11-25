import {verifySession} from '../auth/session.js';

// Targeted, read-only inspection of four linked production stage completions.
// A number match is never treated as a unique document without verification.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-stage-deficit-audit';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const NUMBERS=['00251','00725','01514','02299'];
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const safe=(x,max=130)=>typeof x==='string'&&x.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(x)?x:null;
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x)?x:null;
const ref=x=>{
 const href=x?.meta?.href;
 if(typeof href!=='string'||href.length>400)return null;
 try{
  const url=new URL(href);
  if(url.origin!=='https://api.moysklad.ru')return null;
  const match=url.pathname.match(/\/entity\/([a-z]+)\/([a-f0-9-]{36})(?:$|\/)/i);
  return match&&uuid(match[2])?{type:safe(match[1],50),id:match[2]}:null;
 }catch{return null;}
};
async function read(fetcher,token,path){
 let r;try{r=await fetcher(BASE+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(17000)})}catch{return {error:'transport_or_timeout'};}
 if(r.status!==200){
  let code=null;
  if([400,412,422].includes(r.status))try{
   const txt=(await r.text()).slice(0,3500);
   const obj=JSON.parse(txt);
   if(Number.isSafeInteger(obj?.errors?.[0]?.code))code=obj.errors[0].code;
  }catch{}
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':r.status===403?
   'permission_denied':r.status===401?'token_rejected':'upstream_error',
   http:r.status,msCode:code};
 }
 try{
  const text=await r.text();
  if(text.length>250000)return {error:'response_too_large'};
  const val=JSON.parse(text);
  if(!Array.isArray(val?.rows)||!Number.isSafeInteger(val.meta?.size))
   return {error:'unexpected_shape'};
  return {val};
 }catch{return {error:'bad_json'};}
}
export function createDeficitAudit({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url);}catch{return json(400,{code:'bad_url'});}
  const qs=[...u.searchParams.keys()];
  if(u.origin!==OFFICE||u.pathname!==PATH||u.hash||
   qs.some(x=>x!=='utm_source')||u.searchParams.getAll('utm_source').length>1)
   return json(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB)return json(503,{code:'owner_auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return json(401,{code:'owner_session_required'});}
  if(!sub)return json(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return json(403,{code:'owner_only'});
  }catch{return json(503,{code:'owner_auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return json(503,{code:'ms_token_unavailable'});
  const found=[];
  for(const n of NUMBERS){
   const u=new URL(BASE+'entity/productionstagecompletion');
   u.searchParams.set('limit','5');
   u.searchParams.set('filter','name='+n);
   const res=await read(fetcher,env.MS_API_TOKEN,
    u.toString().slice(BASE.length));
   if(res.error){
    found.push({number:n,status:res.error,http:res.http||null,
     msCode:res.msCode||null});break;
   }
   const rows=res.val.rows;
   const matches=rows.filter(row=>row.name===n);
   found.push({number:n,status:matches.length===1&&res.val.meta.size===1?
     'unique_document':'unverified_match',
     totalFound:res.val.meta.size,matches:matches.map(r=>({
      id:uuid(r.id),number:safe(r.name,50),date:safe(r.moment,40),
      productionTask:ref(r.productionTask),
      productionStage:ref(r.productionStage),
      store:ref(r.store),updated:safe(r.updated,40),
      fieldsPresent:Object.keys(r).slice(0,30)
     }))});
  }
  return json(200,{code:'ms_production_stage_deficit_audit',
   readOnly:true,changedRecords:0,checkedAt:new Date().toISOString(),
   source:'DIRECT_PRODUCTION_STAGE_COMPLETION_LOOKUP',
   queryCount:found.length,expected:4,results:found,
   note:'The four named documents collectively deducted 991 units EACH of film and spunbond in the turnover report. Finding metadata here does not itself prove technical-card errors.'});
 };
}
export const onRequestGet=createDeficitAudit();
