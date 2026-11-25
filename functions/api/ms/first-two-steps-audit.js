import {verifySession} from '../auth/session.js';

// Read-only bounded starting audit for stock + production bills of materials.
// No changes to MoySklad; all findings are a SAMPLE, never full inventory.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/first-two-steps-audit';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const output=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const clean=(v,max=140)=>typeof v==='string'&&v.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(v)?v:null;
const num=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9?v:null;
const uuid=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v)?v:null;
const segments=[
 {key:'warehouses',path:'entity/store?limit=30&offset=0'},
 {key:'techcards',path:'entity/processingplan?limit=20&offset=0'},
 {key:'stocks',path:'report/stock/bystore?limit=20&offset=0&groupBy=variant'}
];
async function read(fetcher,token,url){
 let response;
 try{response=await fetcher(BASE+url,{
  method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(18000)
 });}catch{return {status:'transport_error'};}
 if(response.status!==200){
  await response.body?.cancel().catch(()=>{});
  return {status:response.status===429?'rate_limited':
   response.status===403?'access_denied':
   response.status===401?'token_rejected':'upstream_unavailable',
   http:response.status};
 }
 try{
  const raw=await response.text();
  if(raw.length>262144)return {status:'response_too_large'};
  const obj=JSON.parse(raw);
  if(!Array.isArray(obj.rows)||!Number.isSafeInteger(obj.meta?.size))
   return {status:'unexpected_shape'};
  return {status:'ok',data:obj};
 }catch{return {status:'invalid_json'};}
}
function warehouses(source){
 if(source.status!=='ok')return {status:source.status,upstreamHttp:source.http||null};
 const rows=source.data.rows;
 return {status:'partial_sample',total:source.data.meta.size,
  shown:rows.length,complete:rows.length===source.data.meta.size,
  stores:rows.map(x=>({id:uuid(x.id),name:clean(x.name),
   archived:x.archived===true}))};
}
function techcards(source){
 if(source.status!=='ok')return {status:source.status,upstreamHttp:source.http||null};
 const rows=source.data.rows;
 return {status:'partial_sample',total:source.data.meta.size,
  shown:rows.length,complete:rows.length===source.data.meta.size,
  plans:rows.map(x=>{
   const materialRows=x.materials?.rows;
   const productRows=x.products?.rows;
   const materials=Array.isArray(materialRows)?materialRows:
    Array.isArray(x.materials)?x.materials:null;
   const products=Array.isArray(productRows)?productRows:
    Array.isArray(x.products)?x.products:null;
   return {id:uuid(x.id),name:clean(x.name),updated:clean(x.updated,40),
    archived:x.archived===true,productLines:products?.length??null,
    materialLines:materials?.length??null,
    materialLinesEmbedded:Array.isArray(materials),
    materialSample:Array.isArray(materials)?materials.slice(0,12).map(m=>({
     quantity:num(m.quantity??m.consumption??m.materialQuantity),
     assortmentHrefType:typeof m.assortment?.meta?.type==='string'?
      clean(m.assortment.meta.type,30):null,
     itemHrefType:typeof m.material?.meta?.type==='string'?
      clean(m.material.meta.type,30):null
    })):[],
    possibleZeroOrNegativeMaterialNorms:Array.isArray(materials)?
     materials.filter(m=>num(m.quantity)!==null&&m.quantity<=0).length:null};
  })};
}
function stocks(source){
 if(source.status!=='ok')return {status:source.status,upstreamHttp:source.http||null};
 const rows=source.data.rows;
 const negative=[];
 let visited=0;
 for(const row of rows){
  const groups=Array.isArray(row.stockByStore)?row.stockByStore:[];
  for(const store of groups){
   const qty=num(store.stock),reserve=num(store.reserve);
   visited++;
   if(qty!==null&&qty<0&&negative.length<25)
    negative.push({itemId:uuid(row.meta?.href?.split('/').pop()),
     warehouse:clean(store.name),stock:qty,reserve});
  }
 }
 return {status:'partial_sample',total:source.data.meta.size,
  shown:rows.length,complete:rows.length===source.data.meta.size,
  stockByWarehouseRowsChecked:visited,
  negativeRowsFound:negative.length,negativeSample:negative,
  note:'One page only: no evidence that all inventory has been scanned.'};
}
export function createFirstTwoStepsAudit({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return output(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url);}catch{return output(400,{code:'invalid_scope'});}
  // Links opened from ChatGPT may carry one harmless attribution key.
  const keys=[...u.searchParams.keys()];
  const allowedQuery=keys.every(k=>k==='utm_source')&&
   u.searchParams.getAll('utm_source').length<=1;
  if(u.origin!==ORIGIN||u.pathname!==PATH||!allowedQuery||u.hash)
   return output(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
     !env.OZON_FINANCE_DB)return output(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return output(401,{code:'owner_session_required'});}
  if(!sub)return output(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return output(403,{code:'owner_only'});
  }catch{return output(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
    /\s/.test(env.MS_API_TOKEN))return output(503,{code:'ms_token_unavailable'});
  const results=[];
  for(const segment of segments){
   const next=await read(fetcher,env.MS_API_TOKEN,segment.path);
   results.push(next);
   if(next.status==='rate_limited')break;
  }
  const byKey=Object.fromEntries(segments.map((p,i)=>[
   p.key,results[i]||{status:'not_checked_rate_limit'}]));
  return output(200,{code:'ms_first_two_steps_audit',readOnly:true,
   changedRecords:0,scope:'BOUNDED_FIRST_PAGE_SAMPLES_NOT_FULL_AUDIT',
   checkedAt:new Date().toISOString(),
   warehouses:warehouses(byKey.warehouses),
   techcards:techcards(byKey.techcards),
   stocks:stocks(byKey.stocks),
   next:'Full paginated inventory and processing-plan BOM audits required before correcting records.'});
 };
}
export const onRequestGet=createFirstTwoStepsAudit();
