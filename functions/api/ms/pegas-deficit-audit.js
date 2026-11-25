import {verifySession} from '../auth/session.js';

// Targeted read-only real-time ledger inspection for one verified Pegas SKU.
// No inventory changes; no BOM edits; no fabricated purchase documents.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const ROUTE='/api/ms/pegas-deficit-audit';
const API='https://api.moysklad.ru/api/remap/1.2/';
const PRODUCT_ID='94b23b10-f6af-11f0-0a80-1a6b000a8898';
const CODE='728562139';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const quantity=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9?v:null;
const safe=(v,max=130)=>typeof v==='string'&&v.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(v)?v:null;
async function upstream(fetcher,token,path){
 let r;try{
  r=await fetcher(API+path,{headers:{Authorization:'Bearer '+token,
   Accept:'application/json;charset=utf-8'},method:'GET',redirect:'manual',
   signal:AbortSignal.timeout(17000)});
 }catch{return {error:'upstream_timeout'};}
 if(r.status!==200){
  let msCode=null;
  if([400,412,422].includes(r.status))try{
   const e=JSON.parse((await r.text()).slice(0,4096)).errors?.[0];
   if(Number.isSafeInteger(e?.code))msCode=e.code;
  }catch{}
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':r.status===403?'permission_denied':
   r.status===401?'token_rejected':'upstream_http',http:r.status,msCode};
 }
 try{
  const text=await r.text();
  if(text.length>550000)return {error:'response_too_large'};
  return {value:JSON.parse(text)};
 }catch{return {error:'invalid_response'};}
}
export function createPegasAudit(fetcher=fetch){
 return async function({request,env}){
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  let url;try{url=new URL(request.url)}catch{return json(400,{code:'invalid_url'})}
  if(url.origin!==OFFICE||url.pathname!==ROUTE||url.hash||
   [...url.searchParams.keys()].some(x=>x!=='utm_source')||
   url.searchParams.getAll('utm_source').length>1)
   return json(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return json(503,{code:'owner_auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET)}
  catch{return json(401,{code:'owner_session_required'})}
  if(!sub)return json(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return json(403,{code:'owner_only'});
  }catch{return json(503,{code:'owner_auth_unavailable'})}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
    /\s/.test(env.MS_API_TOKEN))return json(503,{code:'ms_token_unavailable'});
  const token=env.MS_API_TOKEN;
  const product=await upstream(fetcher,token,'entity/product/'+PRODUCT_ID);
  if(product.error)return json(200,{code:'ms_pegas_deficit_audit',readOnly:true,
   changedRecords:0,stage:'product',error:product.error,http:product.http||null});
  if(product.value?.id!==PRODUCT_ID||product.value?.code!==CODE)
   return json(200,{code:'ms_pegas_deficit_audit',readOnly:true,
    changedRecords:0,error:'product_identity_mismatch'});
  const item={id:PRODUCT_ID,code:CODE,name:safe(product.value.name,200),
   catalogPath:safe(product.value.pathName,200),uom:safe(product.value.uom?.name,60)};
  const t=new URL(API+'report/turnover/byoperations');
  t.searchParams.set('filter','product='+API+'entity/product/'+PRODUCT_ID);
  t.searchParams.set('momentFrom','2026-01-01 00:00:00');
  t.searchParams.set('momentTo','2026-11-26 23:59:59');
  t.searchParams.set('limit','100');
  const documents=[];let total=null,scanComplete=false,problem=null;
  for(let offset=0;offset<=300;offset+=100){
   t.searchParams.set('offset',String(offset));
   const r=await upstream(fetcher,token,t.toString().slice(API.length));
   if(r.error){problem={error:r.error,http:r.http||null,msCode:r.msCode||null};break}
   const p=r.value;
   if(!Number.isSafeInteger(p?.meta?.size)||!Array.isArray(p?.rows)||
    p.rows.length>100||(total!==null&&total!==p.meta.size)){
    problem={error:'invalid_or_changed_pagination'};break;
   }
   if(total===null)total=p.meta.size;
   for(const line of p.rows){
    const operation=line?.operation;
    documents.push({type:safe(operation?.meta?.type,80),
     number:safe(operation?.name,100),moment:safe(operation?.moment,45),
     store:safe(line?.store?.name,120),quantity:quantity(line.quantity)});
   }
   if(documents.length>=total){scanComplete=true;break}
   if(p.rows.length!==100){problem={error:'incomplete_page'};break}
  }
  const valid=scanComplete&&documents.every(x=>x.quantity!==null&&x.type);
  const byType={};let incoming=0,outgoing=0;
  if(valid){
   for(const doc of documents){
    incoming+=Math.max(0,doc.quantity);
    outgoing+=Math.min(0,doc.quantity);
    const key=doc.type;
    if(!byType[key])byType[key]={count:0,incoming:0,outgoing:0};
    byType[key].count++;
    byType[key].incoming+=Math.max(0,doc.quantity);
    byType[key].outgoing+=Math.min(0,doc.quantity);
   }
  }
  // Current warehouse balance is a separate report and may change between calls.
  let current=null;
  for(let offset=0;offset<=900;offset+=100){
   const u=new URL(API+'report/stock/bystore');
   u.searchParams.set('limit','100');u.searchParams.set('offset',String(offset));
   u.searchParams.set('groupBy','variant');
   const r=await upstream(fetcher,token,u.toString().slice(API.length));
   if(r.error){current={status:r.error,http:r.http||null};break}
   const p=r.value;
   if(!Number.isSafeInteger(p?.meta?.size)||!Array.isArray(p.rows)){
    current={status:'unverified_stock_shape'};break}
   const found=p.rows.filter(x=>typeof x?.meta?.href==='string'&&
    x.meta.href.endsWith('/entity/product/'+PRODUCT_ID));
   if(found.length>1){current={status:'duplicate_stock_rows'};break}
   if(found.length===1){
    current={status:'found',byStore:Array.isArray(found[0].stockByStore)?
     found[0].stockByStore.map(x=>({warehouse:safe(x.name,120),
      stock:quantity(x.stock),reserve:quantity(x.reserve)})):null};
    break;
   }
   if(offset+p.rows.length>=p.meta.size){
    current={status:'not_in_stock_report'};break;
   }
   if(!p.rows.length){current={status:'pagination_unverified'};break}
  }
  return json(200,{code:'ms_pegas_deficit_audit',readOnly:true,
   changedRecords:0,checkedAt:new Date().toISOString(),item,current,
   reportWindow:'2026-01-01..2026-11-26',turnover:{
    status:valid?'complete':problem?.error||'incomplete',
    total,read:documents.length,
    incoming:valid?Number(incoming.toFixed(6)):null,
    outgoing:valid?Number(outgoing.toFixed(6)):null,
    net:valid?Number((incoming+outgoing).toFixed(6)):null,
    byType:valid?byType:null,documents:documents.slice(-400)},
   diagnosis:'Quantity movement alone cannot prove incorrect BOM. Verify production document links and processing-plan norms; physical stock and missing receipts remain separate hypotheses.'});
 };
}
export const onRequestGet=createPegasAudit();
