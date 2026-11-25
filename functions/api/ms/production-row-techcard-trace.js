import {verifySession} from '../auth/session.js';

// Reconciles four specific known production rows with their tasks/plans.
// Read-only. All MoySklad resource IDs are fixed from verified owner output.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-row-techcard-trace';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const TASKS=[
 {completion:'00251',task:'ad22ef8f-3844-11f1-0a80-03930001b209',row:'5bec5a10-3846-11f1-0a80-106c0001518b',completed:304},
 {completion:'00725',task:'b026d653-49e9-11f1-0a80-0713000784ef',row:'b026e907-49e9-11f1-0a80-0713000784ff',completed:196},
 {completion:'01514',task:'9c58b085-5fa8-11f1-0a80-019f0001e763',row:'9c58d195-5fa8-11f1-0a80-019f0001e78b',completed:263},
 {completion:'02299',task:'35fc732c-6fe8-11f1-0a80-1bf700131995',row:'35fcae50-6fe8-11f1-0a80-1bf7001319b3',completed:228}
];
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x)?x:null;
const safe=(x,max=160)=>typeof x==='string'&&x.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(x)?x:null;
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10000000?x:null;
function ref(x){
 const href=x?.meta?.href;
 if(typeof href!=='string'||href.length>450)return null;
 try{
  const u=new URL(href);
  const m=/^\/api\/remap\/1\.2\/entity\/([a-z]+)\/([a-f0-9-]{36})$/i.exec(u.pathname);
  return u.origin==='https://api.moysklad.ru'&&m&&uuid(m[2])?
   {type:safe(m[1],60),id:m[2]}:null;
 }catch{return null;}
}
async function read(fetcher,token,path){
 let r;
 try{r=await fetcher(BASE+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(14500)})}catch{return {error:'transport_or_timeout'};}
 if(r.status!==200){
  let msCode=null;
  if([400,412,422].includes(r.status))try{
   const raw=(await r.text()).slice(0,4000);
   const error=JSON.parse(raw)?.errors?.[0];
   if(Number.isSafeInteger(error?.code))msCode=error.code;
  }catch{}
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':r.status===401?'token_rejected':
   r.status===403?'permission_denied':'upstream_http',http:r.status,msCode};
 }
 try{
  const raw=await r.text();
  if(raw.length>250000)return {error:'oversized'};
  return {value:JSON.parse(raw)};
 }catch{return {error:'bad_json'};}
}
function describe(source,expected){
 if(source.error)return {status:source.error,http:source.http||null,
  msCode:source.msCode||null};
 const x=source.value;
 if(!x||!uuid(x.id)||x.id.toLowerCase()!==expected.toLowerCase())
  return {status:'identity_unverified',fields:Object.keys(x||{}).slice(0,30)};
 return {status:'ok',id:x.id,name:safe(x.name),moment:safe(x.moment,40),
  quantity:num(x.quantity),processingPlan:ref(x.processingPlan),
  techcard:ref(x.processingPlan),product:ref(x.product),
  assortment:ref(x.assortment),productionTask:ref(x.productionTask),
  materials:ref(x.materials),productionRows:ref(x.productionRows),
  fieldsPresent:Object.keys(x).slice(0,45)};
}
export function createTrace({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url);}catch{return reply(400,{code:'invalid_url'});}
  if(u.origin!==OFFICE||u.pathname!==PATH||u.hash||
   [...u.searchParams.keys()].some(k=>k!=='utm_source')||
   u.searchParams.getAll('utm_source').length>1)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB)return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return reply(401,{code:'owner_session_required'});}
  if(!sub)return reply(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return reply(503,{code:'ms_token_unavailable'});
  const findings=[];
  for(const x of TASKS){
   const task=describe(await read(fetcher,env.MS_API_TOKEN,
    'entity/productiontask/'+x.task),x.task);
   const row=describe(await read(fetcher,env.MS_API_TOKEN,
    'entity/productiontask/'+x.task+'/productionrows/'+x.row),x.row);
   findings.push({completion:x.completion,completed:x.completed,
    task,row,
    planCandidate:row.processingPlan||task.processingPlan||null
   });
   if(task.status==='rate_limited'||row.status==='rate_limited')break;
  }
  const distinctPlanIds=[...new Set(findings.map(x=>x.planCandidate)
   .filter(x=>x?.type==='processingplan').map(x=>x.id))].slice(0,4);
  const plans=[];
  for(const id of distinctPlanIds){
   const resp=await read(fetcher,env.MS_API_TOKEN,
    'entity/processingplan/'+id);
   if(resp.error){plans.push({id,status:resp.error,http:resp.http||null});break;}
   const v=resp.value;
   plans.push({id,status:uuid(v.id)===id?'ok':'unverified_identity',
    name:safe(v.name),product:ref(v.product),
    fieldsPresent:Object.keys(v||{}).slice(0,35)});
  }
  return reply(200,{code:'ms_production_row_techcard_trace',
   readOnly:true,changedRecords:0,checkedAt:new Date().toISOString(),
   checked:findings.length,expected:4,results:findings,plans,
   note:'Only known production tasks and rows queried. No production quantities or norms were changed. Processing-plan references, if present, require a separate BOM comparison.'});
 };
}
export const onRequestGet=createTrace();
