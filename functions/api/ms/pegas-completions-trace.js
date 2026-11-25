import {verifySession} from '../auth/session.js';

// Read-only targeted trace of THREE already identified Pegas completions.
// Never mutate product, processing plan, stock or production documents.
const API='https://api.moysklad.ru/api/remap/1.2/';
const HOST='https://autosklad63-office-staging.pages.dev';
const ROUTE='/api/ms/pegas-completions-trace';
const PEGAS='94b23b10-f6af-11f0-0a80-1a6b000a8898';
const TARGETS={'07787':-64,'08870':-48,'08185':-32};
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const reply=(status,x)=>new Response(JSON.stringify(x),{status,headers:HEADERS});
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e9?x:null;
const safe=(x,max=120)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u001f\u007f]/u.test(x)?x:null;
const ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function ref(x){
 const url=x?.meta?.href;if(typeof url!=='string'||url.length>450)return null;
 try{const u=new URL(url);const m=/^\/api\/remap\/1\.2\/entity\/([a-z]+)\/([a-f0-9-]{36})$/i.exec(u.pathname);
  return u.origin==='https://api.moysklad.ru'&&m&&ID.test(m[2])?
   {type:m[1],id:m[2].toLowerCase()}:null;}catch{return null;}
}
async function read(fetcher,token,path){
 let r;try{r=await fetcher(API+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(17000)})}catch{return {error:'timeout_or_transport'}}
 if(r.status!==200){await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':'http_'+r.status}}
 try{const s=await r.text();if(s.length>350000)return {error:'oversize'};
  return {value:JSON.parse(s)}}catch{return {error:'invalid_json'}}
}
function extract(x){
 if(!Array.isArray(x?.rows)||!Number.isSafeInteger(x?.meta?.size))
  return {status:'invalid_collection'};
 return {status:x.rows.length===x.meta.size?'complete':'partial',
  size:x.meta.size,
  lines:x.rows.slice(0,60).map(v=>({
   item:ref(v.assortment)||ref(v.product)||ref(v.material),
   quantity:num(v.quantity),consumedQuantity:num(v.consumedQuantity),
   producedQuantity:num(v.producedQuantity),
   fields:Object.keys(v||{}).slice(0,16)
  }))};
}
export function makePegasTrace(fetcher=fetch){
 return async({request,env})=>{
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url)}catch{return reply(400,{code:'invalid_url'})}
  if(u.origin!==HOST||u.pathname!==ROUTE||u.hash||
    [...u.searchParams.keys()].some(x=>x!=='utm_source'))
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET)}
   catch{return reply(401,{code:'owner_login_required'})}
  if(!sub)return reply(401,{code:'owner_login_required'});
  try{
   const row=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(row?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'})}
  const token=env.MS_API_TOKEN;
  if(typeof token!=='string'||!token||/\s/.test(token))
   return reply(503,{code:'ms_token_unavailable'});
  const t=new URL(API+'report/turnover/byoperations');
  t.searchParams.set('filter','product='+API+'entity/product/'+PEGAS);
  t.searchParams.set('momentFrom','2026-11-01 00:00:00');
  t.searchParams.set('momentTo','2026-11-26 23:59:59');
  t.searchParams.set('limit','100');
  const tr=await read(fetcher,token,t.toString().slice(API.length));
  if(tr.error)return reply(200,{code:'ms_pegas_completions_trace',readOnly:true,
   changedRecords:0,status:tr.error});
  const report=tr.value;
  if(!Array.isArray(report?.rows)||!Number.isSafeInteger(report.meta?.size)||
    report.rows.length!==report.meta.size)
   return reply(200,{code:'ms_pegas_completions_trace',readOnly:true,
    changedRecords:0,status:'turnover_not_complete',total:report?.meta?.size||null});
  const results=[];
  for(const [number,expected] of Object.entries(TARGETS)){
   const rows=report.rows.filter(x=>x.operation?.name===number&&
    x.operation?.meta?.type==='productionstagecompletion');
   if(rows.length!==1||num(rows[0].quantity)!==expected){
    results.push({number,status:'operation_not_unique_or_amount_changed',
     matches:rows.length,actual:rows.map(x=>num(x.quantity))});continue;
   }
   const operation=ref(rows[0].operation);
   if(operation?.type!=='productionstagecompletion'){
    results.push({number,status:'invalid_operation_reference'});continue;
   }
   const base='entity/productionstagecompletion/'+operation.id;
   const d=await read(fetcher,token,base);
   if(d.error){results.push({number,status:d.error});continue}
   const mat=await read(fetcher,token,base+'/materials?limit=100');
   const prod=await read(fetcher,token,base+'/products?limit=100');
   const v=d.value;
   results.push({number,status:'document_checked',id:operation.id,
    date:safe(v.moment,45),posted:v.applicable===true,
    productionTask:ref(v.productionTask),productionStage:ref(v.productionStage),
    processingPlan:ref(v.processingPlan),
    documentFields:Object.keys(v).slice(0,40),
    pegasTurnover:expected,
    materials:mat.error?{status:mat.error}:extract(mat.value),
    products:prod.error?{status:prod.error}:extract(prod.value)});
   if(mat.error==='rate_limited'||prod.error==='rate_limited')break;
  }
  return reply(200,{code:'ms_pegas_completions_trace',readOnly:true,
   changedRecords:0,checkedAt:new Date().toISOString(),results,
   interpretation:'Only selected operation documents and components. Plan norm requires reading linked processing plan; quantities alone do not prove excessive consumption.'});
 };
}
export const onRequestGet=makePegasTrace();
