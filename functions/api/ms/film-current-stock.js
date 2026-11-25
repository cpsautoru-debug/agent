import {verifySession} from '../auth/session.js';

// Owner-only real-time stock check for verified film SKU (and spunbond for comparison).
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/film-current-stock';
const REPORT='https://api.moysklad.ru/api/remap/1.2/report/stock/bystore';
const PRODUCTS={
 film:{id:'f3974a16-3845-11f1-0a80-1d900001798c',name:'ПЛЕНКА',code:'728562248'},
 spunbond:{id:'fdafcb03-3845-11f1-0a80-0e8e0001aa8c',name:'СПАНБОНД ЧЕРНЫЙ',code:'728562249'}
};
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e9?x:null;
const safe=x=>typeof x==='string'&&x.length<140&&!/[\u0000-\u001f\u007f]/.test(x)?x:null;
function productId(row){
 const href=row?.meta?.href||row?.assortment?.meta?.href;
 if(typeof href!=='string')return null;
 try{
  const u=new URL(href);
  const match=/^\/api\/remap\/1\.2\/entity\/(?:product|variant)\/([a-f0-9-]{36})$/i.exec(u.pathname);
  return u.origin==='https://api.moysklad.ru'&&match?match[1].toLowerCase():null;
 }catch{return null;}
}
async function getPage(fetcher,token,offset){
 const u=new URL(REPORT);
 u.searchParams.set('limit','100');u.searchParams.set('offset',String(offset));
 u.searchParams.set('groupBy','variant');
 let r;
 try{r=await fetcher(u.toString(),{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(15000)})}catch{return {error:'timeout_or_transport'};}
 if(r.status!==200){
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':'upstream_http',http:r.status};
 }
 try{
  const raw=await r.text();if(raw.length>600000)return {error:'oversized'};
  const val=JSON.parse(raw);
  if(!Array.isArray(val?.rows)||!Number.isSafeInteger(val?.meta?.size)||
   val.rows.length>100)return {error:'invalid_report'};
  return {value:val};
 }catch{return {error:'invalid_json'};}
}
export function createFilmStock({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url)}catch{return json(400,{code:'invalid_url'})}
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.hash||
   [...u.searchParams.keys()].some(x=>x!=='utm_source')||
   u.searchParams.getAll('utm_source').length>1)
   return json(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
    !env.OZON_FINANCE_DB)return json(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET)}
  catch{return json(401,{code:'owner_login_required'})}
  if(!sub)return json(401,{code:'owner_login_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return json(403,{code:'owner_only'});
  }catch{return json(503,{code:'auth_unavailable'})}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
    /\s/.test(env.MS_API_TOKEN))return json(503,{code:'ms_token_unavailable'});
  const collected={film:[],spunbond:[]};let total=null,read=0,problem=null;
  for(let offset=0;offset<=900;offset+=100){
   const r=await getPage(fetcher,env.MS_API_TOKEN,offset);
   if(r.error){problem={status:r.error,http:r.http||null};break;}
   const v=r.value;
   if(total===null)total=v.meta.size;
   if(total!==v.meta.size){problem={status:'concurrent_changes'};break;}
   for(const row of v.rows){
    const id=productId(row);
    for(const [key,product] of Object.entries(PRODUCTS)){
     if(id===product.id){
      collected[key].push({
       stock:finite(row.stock),
       byStore:Array.isArray(row.stockByStore)?row.stockByStore.slice(0,25).map(x=>({
        store:safe(x.name),stock:finite(x.stock),reserve:finite(x.reserve),
        inTransit:finite(x.inTransit)})):[],
       unitFromReport:safe(row.uom?.name)
      });
     }
    }
   }
   read+=v.rows.length;
   if(read>=total)break;
  }
  const complete=total!==null&&read===total&&!problem;
  return json(200,{code:'ms_film_current_stock',readOnly:true,changedRecords:0,
   checkedAt:new Date().toISOString(),source:'MOYSKLAD_CURRENT_STOCK_BYSTORE',
   scanned:read,total,complete,error:problem,
   items:Object.fromEntries(Object.entries(PRODUCTS).map(([k,p])=>[k,{
    name:p.name,code:p.code,id:p.id,
    status:complete?(collected[k].length===1?'found':collected[k].length===0?
     'not_in_report':'duplicate_report_rows'):'incomplete_scan',
    reports:collected[k]
   }])),
   warning:'Warehouse stock is current when checked. A posted 1081 receipt does not prove 1081 physically entered. No inventory writes.'});
 };
}
export const onRequestGet=createFilmStock();
