import {verifySession} from '../auth/session.js';

// Read-only verification of bag cutting -> sewing, from posting date 25.11.2026.
// Does NOT infer batch allocation from aggregate warehouse stock.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/bag-sewing-reconciliation';
const API='https://api.moysklad.ru/api/remap/1.2/';
const ITEMS=[
 {key:'cut',code:'728562247',label:'Крой сумка'},
 {key:'finished',code:'728562176',label:'Сумка под ЧЕХЛЫ'},
 {key:'zip',code:'728562181',label:'Молния черная T5'},
 {key:'slider',code:'728562182',label:'Бегунки черные T5'}
];
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:H});
const n=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e9?x:null;
const str=(x,max=110)=>typeof x==='string'&&x.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(x)?x:null;
const validId=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
function refId(x){
 const href=x?.meta?.href;
 if(typeof href!=='string')return null;
 try{
  const u=new URL(href),m=u.pathname.match(/^\/api\/remap\/1\.2\/entity\/(?:product|variant)\/([a-f0-9-]{36})$/i);
  return u.origin==='https://api.moysklad.ru'&&m&&validId(m[1])?m[1].toLowerCase():null;
 }catch{return null;}
}
async function read(fetcher,token,path){
 let r;try{
  r=await fetcher(API+path,{method:'GET',redirect:'manual',
   headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
   signal:AbortSignal.timeout(17000)});
 }catch{return {error:'transport_or_timeout'};}
 if(r.status!==200){
  let errorCode=null;
  if([400,412,422].includes(r.status))try{
   const txt=(await r.text()).slice(0,4000),data=JSON.parse(txt);
   if(Number.isSafeInteger(data?.errors?.[0]?.code))errorCode=data.errors[0].code;
  }catch{}
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':r.status===401?'token_rejected':
   r.status===403?'permission_denied':'upstream_http',
   http:r.status,msErrorCode:errorCode};
 }
 try{
  const raw=await r.text();
  if(raw.length>650000)return {error:'response_too_large'};
  return {value:JSON.parse(raw)};
 }catch{return {error:'bad_json'};}
}
function summarizeReport(raw,key){
 if(!Array.isArray(raw?.rows)||!Number.isSafeInteger(raw?.meta?.size))
  return {status:'unexpected_report_shape'};
 const rows=raw.rows;
 const byType={},documents=[];
 let incoming=0,outgoing=0,unknown=0;
 for(const x of rows){
  const quantity=n(x?.quantity),type=str(x?.operation?.meta?.type,65);
  if(quantity===null){unknown++;continue;}
  if(quantity>0)incoming+=quantity;else outgoing+=quantity;
  if(type)byType[type]=(byType[type]||0)+1;
  documents.push({type,number:str(x?.operation?.name,70),
   date:str(x?.operation?.moment,45),store:str(x?.store?.name,100),
   quantity});
 }
 const total=raw.meta.size,complete=rows.length===total;
 return {status:complete?'complete':'partial_first_100',
  total,read:rows.length,byType,
  positive:Math.round(incoming*1e6)/1e6,
  negative:Math.round(outgoing*1e6)/1e6,
  net:Math.round((incoming+outgoing)*1e6)/1e6,unknown,
  documents:documents.slice(-100),
  note:complete?'All report rows read for selected date range':
   'Do not use these movement totals to close reconciliation; report is truncated'};
}
export function createBagSewingAudit({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  let url;try{url=new URL(request.url)}catch{return reply(400,{code:'invalid_url'})}
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||
   [...url.searchParams.keys()].some(k=>k!=='utm_source')||
   url.searchParams.getAll('utm_source').length>1)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET)}
  catch{return reply(401,{code:'owner_login_required'})}
  if(!sub)return reply(401,{code:'owner_login_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return reply(503,{code:'ms_token_unavailable'});
  const results={},token=env.MS_API_TOKEN;
  for(const item of ITEMS){
   const p=new URL(API+'entity/product');
   p.searchParams.set('filter','code='+item.code);
   p.searchParams.set('limit','5');
   const found=await read(fetcher,token,p.toString().slice(API.length));
   if(found.error){
    results[item.key]={code:item.code,status:'product_lookup_failed',
     http:found.http||null,msErrorCode:found.msErrorCode||null,
     reason:found.error};
    if(found.error==='rate_limited')break;
    continue;
   }
   const rows=found.value?.rows;
   if(!Array.isArray(rows)||!Number.isSafeInteger(found.value?.meta?.size)){
    results[item.key]={code:item.code,status:'invalid_product_lookup'};continue;
   }
   const verified=rows.filter(x=>x.code===item.code&&validId(x.id));
   if(verified.length!==1||found.value.meta.size!==1){
    results[item.key]={code:item.code,status:'identity_not_unique',
     matches:verified.length,total:found.value.meta.size};continue;
   }
   const id=verified[0].id;
   const t=new URL(API+'report/turnover/byoperations');
   t.searchParams.set('filter','product='+API+'entity/product/'+id);
   t.searchParams.set('momentFrom','2026-11-24 00:00:00');
   t.searchParams.set('momentTo','2026-11-26 23:59:59');
   // Date-scoped, no full-history data scan. Response is explicitly bounded.
   const turnover=await read(fetcher,token,t.toString().slice(API.length));
   results[item.key]={code:item.code,id,name:str(verified[0].name,150),
    uom:str(verified[0]?.uom?.name,50),
    turnover:turnover.error?
     {status:turnover.error,http:turnover.http||null,
      msErrorCode:turnover.msErrorCode||null}:
     summarizeReport(turnover.value,item.key)};
   if(turnover.error==='rate_limited')break;
  }
  const cut=results.cut?.turnover,finished=results.finished?.turnover;
  const cutConsumed=cut?.status==='complete'?
   cut.documents.filter(x=>x.type==='productionstagecompletion'&&x.quantity<0)
    .reduce((s,x)=>s-x.quantity,0):null;
  const finishedProduced=finished?.status==='complete'?
   finished.documents.filter(x=>x.type==='productionstagecompletion'&&x.quantity>0)
    .reduce((s,x)=>s+x.quantity,0):null;
  const sewingComplete=cutConsumed!==null&&finishedProduced!==null;
  return reply(200,{code:'ms_bag_sewing_reconciliation',
   checkedAt:new Date().toISOString(),readOnly:true,changedRecords:0,
   batchCutExpected:405,selectedPeriod:'2026-11-24 through 2026-11-26, inclusive',
   results,summary:{cutConsumedInCompletions:cutConsumed,
    finishedProducedInCompletions:finishedProduced,
    reconciledAgainstBatch:sewingComplete?false:null,
    caution:'The 405-cut batch has not been linked to specific sewing documents. Aggregate production and stock do not prove batch allocation; inspect operation numbers and related tasks.'},
   note:'Read-only operational reconciliation. Expense amount and labour payment are NOT verified. Historical stock entry issue remains open.'});
 };
}
export const onRequestGet=createBagSewingAudit();
