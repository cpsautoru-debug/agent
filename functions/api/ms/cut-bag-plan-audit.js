import {verifySession} from '../auth/session.js';

// Read-only focused audit of the verified "Крой сумка" processing plan.
// Never infer physical consumption units from ledger units.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/cut-bag-plan-audit';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const ID='08e33e31-3846-11f1-0a80-03930001b4e4';
const FILM='f3974a16-3845-11f1-0a80-1d900001798c';
const SPUNBOND='fdafcb03-3845-11f1-0a80-0e8e0001aa8c';
const OUT='d5eba0c7-3845-11f1-0a80-160300017f1a';
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:H});
const qty=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e8?x:null;
const safe=(x,max=160)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x)?x:null;
const validId=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
function ref(x){
 const href=x?.meta?.href;
 if(typeof href!=='string'||href.length>350)return null;
 try{
  const u=new URL(href);
  const m=/^\/api\/remap\/1\.2\/entity\/([a-z]+)\/([a-f0-9-]{36})$/i.exec(u.pathname);
  return u.origin==='https://api.moysklad.ru'&&m&&validId(m[2])?
   {type:m[1],id:m[2].toLowerCase()}:null;
 }catch{return null;}
}
async function get(fetcher,token,path){
 let r;
 try{r=await fetcher(BASE+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(15500)})}catch{return {error:'transport_or_timeout'};}
 if(r.status!==200){
  let msCode=null;
  if([400,412,422].includes(r.status))try{
   const raw=(await r.text()).slice(0,3500),obj=JSON.parse(raw);
   if(Number.isSafeInteger(obj?.errors?.[0]?.code))msCode=obj.errors[0].code;
  }catch{}
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':r.status===403?'permission_denied':
   r.status===401?'token_rejected':'upstream_http',http:r.status,msCode};
 }
 try{
  const raw=await r.text();
  if(raw.length>220000)return {error:'oversize'};
  return {value:JSON.parse(raw)};
 }catch{return {error:'invalid_json'};}
}
function collection(result){
 if(result.error)return {status:result.error,http:result.http||null,
  msCode:result.msCode||null};
 const v=result.value;
 if(!Array.isArray(v?.rows)||!Number.isSafeInteger(v?.meta?.size))
  return {status:'unexpected_shape'};
 const complete=v.rows.length===v.meta.size;
 const lines=v.rows.slice(0,80).map(x=>({
  assortment:ref(x.assortment)||ref(x.material)||ref(x.product),
  quantity:qty(x.quantity),consumedQuantity:qty(x.consumedQuantity),
  producedQuantity:qty(x.producedQuantity),
  fieldsPresent:Object.keys(x||{}).slice(0,20)
 }));
 return {status:'ok',total:v.meta.size,read:v.rows.length,complete,lines};
}
export function makeCutBagAudit({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  let u;
  try{u=new URL(request.url)}catch{return reply(400,{code:'invalid_scope'})}
  if(u.origin!==OFFICE||u.pathname!==PATH||u.hash||
   [...u.searchParams.keys()].some(k=>k!=='utm_source')||
   u.searchParams.getAll('utm_source').length>1)return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB)return reply(503,{code:'auth_unavailable'});
  let sub;
  try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET)}
  catch{return reply(401,{code:'owner_session_required'})}
  if(!sub)return reply(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return reply(503,{code:'ms_token_unavailable'});
  const token=env.MS_API_TOKEN,base='entity/processingplan/'+ID;
  const plan=await get(fetcher,token,base);
  const mats=collection(await get(fetcher,token,base+'/materials?limit=100'));
  const products=collection(await get(fetcher,token,base+'/products?limit=100'));
  const v=plan.value;
  const matching=Object.fromEntries([
   ['film',FILM],['spunbond',SPUNBOND],['cutBagOutput',OUT]
  ].map(([k,id])=>[k,{
   materials:mats.lines?.filter(x=>x.assortment?.id===id)||[],
   products:products.lines?.filter(x=>x.assortment?.id===id)||[]
  }]));
  return reply(200,{code:'ms_cut_bag_plan_audit',readOnly:true,changedRecords:0,
   checkedAt:new Date().toISOString(),planId:ID,
   plan:plan.error?{status:plan.error,http:plan.http||null}:{
    status:validId(v?.id)&&v.id.toLowerCase()===ID?'ok':'identity_unverified',
    name:safe(v?.name),archived:v?.archived===true,
    processingProcess:ref(v?.processingProcess),
    fieldsPresent:Object.keys(v||{}).slice(0,35)},
   materials:mats,products,matching,
   verifiedDocumentConsumption:{film:991,spunbond:991,completionCount:4,
    eachPerCompletedProductionUnit:1},
   caveat:'BOM quantities are plan norms. Actual source unit, physical usage, historical plan revisions and goods receipts remain unverified; read-only.'});
 };
}
export const onRequestGet=makeCutBagAudit();
