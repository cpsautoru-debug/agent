import {verifySession} from '../auth/session.js';

// Owner-only, read-only turnover history for selected known negative items.
// Current balances come from the separate stock report; no corrections are made.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/negative-stock-causes';
const API='https://api.moysklad.ru/api/remap/1.2/';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const TARGETS=Object.freeze([
 {name:'ПЛЕНКА',code:'728562248',id:'f3974a16-3845-11f1-0a80-1d900001798c',unit:'шт'},
 {name:'СПАНБОНД ЧЕРНЫЙ',code:'728562249',id:'fdafcb03-3845-11f1-0a80-0e8e0001aa8c',unit:'шт'},
 {name:'Кант (Черный)',code:'017',id:'112c76ea-1b88-11f1-0a80-096400296a5d',unit:null},
 {name:'Липучка жесткая 25мм',code:'728562180',id:'cfd25ff1-1ac3-11f1-0a80-16a500223fe0',unit:'м'},
 {name:'Крючки',code:'728562177',id:'7e417513-1ac3-11f1-0a80-138a0021749f',unit:'шт'},
 {name:'Экокожа Pegas, перфорация 5x5',code:'728562139',id:'94b23b10-f6af-11f0-0a80-1a6b000a8898',unit:'м'},
 {name:'Крой Веста, алькантара белый квадрат',code:'728562174',id:'47529d78-1ac2-11f1-0a80-03820020cb93',unit:'шт'},
 {name:'ОТПРАВКА ЯНДЕКС',code:'00044',id:'42ac948d-b4e5-11f0-0a80-159c0029f227',unit:'шт'}
]);
const str=(x,max=140)=>typeof x==='string'&&x.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(x)?x:null;
const number=x=>typeof x==='number'&&Number.isFinite(x)&&
 Math.abs(x)<1000000000?x:null;
const TURNOVER_LIMIT=1000;
const TURNOVER_MAX_PAGES=20;
const TURNOVER_MAX_ROWS=20000;
const MOVEMENT_CATEGORY=Object.freeze({
 supply:'receipt',
 productionstagecompletion:'production_consumption',
 move:'transfer',
 loss:'write_off',
 enter:'adjustment',
 inventory:'inventory_correction_candidate',
 demand:'sale_or_issue',
 purchasereturn:'supplier_return',
 salesreturn:'customer_return'
});
const categoryLabel=Object.freeze({
 receipt:'Поступление',
 production_consumption:'Производственное потребление',
 transfer:'Перемещение (направление требует документа)',
 write_off:'Списание',
 adjustment:'Оприходование / корректировка',
 inventory_correction_candidate:'Инвентаризация (проверить документ)',
 sale_or_issue:'Отгрузка / расход',
 supplier_return:'Возврат поставщику',
 customer_return:'Возврат покупателя',
 other:'Другой тип документа'
});
function validNextHref(href,{offset,item,from,to}){
 if(typeof href!=='string'||href.length>3000)return false;
 try{
  const next=new URL(href),expected=new URL(API+'report/turnover/byoperations');
  return next.origin===expected.origin&&next.pathname===expected.pathname&&
   !next.username&&!next.password&&!next.hash&&
   next.searchParams.get('offset')===String(offset)&&
   next.searchParams.get('limit')===String(TURNOVER_LIMIT)&&
   next.searchParams.get('filter')==='product='+API+'entity/product/'+item.id&&
   next.searchParams.get('momentFrom')===from&&
   next.searchParams.get('momentTo')===to;
 }catch{return false;}
}
async function getReport(fetcher,token,item){
 const from='2016-01-01 00:00:00';
 const to=new Date().toISOString().slice(0,10)+' 23:59:59';
 const docs=[],identities=new Set(),counts={};
 let offset=0,total=null,pages=0;
 for(;pages<TURNOVER_MAX_PAGES;pages++){
  const url=new URL(API+'report/turnover/byoperations');
  url.searchParams.set('limit',String(TURNOVER_LIMIT));
  url.searchParams.set('offset',String(offset));
  url.searchParams.set('filter','product='+API+'entity/product/'+item.id);
  url.searchParams.set('momentFrom',from);
  url.searchParams.set('momentTo',to);
  let res;
  try{res=await fetcher(url.toString(),{method:'GET',redirect:'manual',
   headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8',
    'Accept-Encoding':'gzip'},
   signal:AbortSignal.timeout(16000)})}catch{
   return {...item,status:'api_transport_error',complete:false,documents:[],
    pages,readCount:offset};
  }
  if(res.status!==200){
   let upstreamCode=null,upstreamMessage=null;
   if(res.status===412||res.status===400){
    try{
     const raw=(await res.text()).slice(0,5000);
     const payload=JSON.parse(raw);
     const err=Array.isArray(payload?.errors)?payload.errors[0]:null;
     if(Number.isSafeInteger(err?.code))upstreamCode=err.code;
     const msg=err?.error||err?.message;
     if(typeof msg==='string'&&msg.length<=200&&
       !/https?:\/\/|Bearer|token|[\u0000-\u001f]/i.test(msg))
      upstreamMessage=msg;
    }catch{}
   }else await res.body?.cancel().catch(()=>{});
   return {...item,upstreamCode,upstreamMessage,complete:false,
    status:res.status===412?'invalid_turnover_request':
     res.status===429?'rate_limited':
     res.status===403?'permission_denied':
     res.status===401?'token_rejected':
     res.status===400?'filter_rejected':'upstream_error',
    http:res.status,documents:[],pages,readCount:offset};
  }
  let data;
  try{
   const raw=await res.text();
   if(raw.length>3_000_000)
    return {...item,status:'response_too_large',complete:false,documents:[],pages,readCount:offset};
   data=JSON.parse(raw);
  }catch{return {...item,status:'invalid_upstream_json',complete:false,documents:[],pages,readCount:offset};}
  if(!Array.isArray(data?.rows)||!Number.isSafeInteger(data?.meta?.size)||
    data.meta.size<0||data.meta.size>TURNOVER_MAX_ROWS||
    data.rows.length>TURNOVER_LIMIT||
    (data.meta.offset!==undefined&&data.meta.offset!==offset)||
    (total!==null&&data.meta.size!==total)){
   return {...item,status:'pagination_inconsistent',complete:false,documents:[],pages,readCount:offset};
  }
  total=data.meta.size;
  const expected=Math.min(TURNOVER_LIMIT,Math.max(0,total-offset));
  if(data.rows.length!==expected)
   return {...item,status:'pagination_incomplete',complete:false,documents:[],pages:pages+1,readCount:offset+data.rows.length,documentCount:total};
  for(const row of data.rows){
   const operation=row?.operation,type=str(operation?.meta?.type,45);
   const operationHref=str(operation?.meta?.href,500);
   const storeName=str(row?.store?.name,120);
   const storeHref=str(row?.store?.meta?.href,500);
   if(!type||!operationHref||!storeName||
      typeof row.quantity!=='number'||!Number.isFinite(row.quantity)||
      !Number.isSafeInteger(Date.parse(operation.moment||''))){
    return {...item,status:'unverified_operational_shape',complete:false,
     reportedRows:total,columnsPresent:Object.keys(row||{}).slice(0,25),
     documents:[],pages:pages+1,readCount:offset+data.rows.length};
   }
   const identity=operationHref+'|'+(storeHref||storeName);
   if(identities.has(identity))
    return {...item,status:'pagination_duplicate',complete:false,documents:[],
     pages:pages+1,readCount:offset+data.rows.length};
   identities.add(identity);
   const category=MOVEMENT_CATEGORY[type]||'other';
   counts[category]=(counts[category]||0)+1;
   docs.push({
    documentType:type,category,categoryLabel:categoryLabel[category],
    documentNumber:str(operation.name,80),date:str(operation.moment,40),
    warehouse:storeName,quantity:row.quantity,
    unit:str(row.assortment?.uom?.name,40)||item.unit,
    movementId:operationHref.split('/').pop()
   });
  }
  const nextOffset=offset+data.rows.length;
  if(nextOffset===total){
   return {...item,status:'document_list_complete',complete:true,
    documentCount:total,readCount:nextOffset,pages:pages+1,
    period:{from,to},countByCategory:counts,documents:docs,
    sourceReport:'report/turnover/byoperations',
    completeness:'All pages in the requested period were read; this report is not an atomic snapshot. Quantities are document quantities; movement direction for transfers and causality of a negative balance must be confirmed against the underlying documents and opening/physical balance.'};
  }
  if(!data.rows.length||data.meta?.nextHref&&
      !validNextHref(data.meta.nextHref,{offset:nextOffset,item,from,to})){
   return {...item,status:'pagination_inconsistent',complete:false,
    documents:[],pages:pages+1,readCount:nextOffset};
  }
  offset=nextOffset;
 }
 return {...item,status:'page_limit_exceeded',complete:false,documents:[],
  pages:TURNOVER_MAX_PAGES,readCount:offset,documentCount:total};
}
export function createNegativeCausesAudit({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  let url;
  try{url=new URL(request.url);}catch{return reply(400,{code:'invalid_scope'});}
  const params=[...url.searchParams.keys()];
  if(url.origin!==OFFICE||url.pathname!==PATH||url.hash||
   params.some(k=>k!=='utm_source')||
   url.searchParams.getAll('utm_source').length>1)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB)return reply(503,{code:'auth_unavailable'});
  let ownerId;
  try{ownerId=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return reply(401,{code:'owner_session_required'});}
  if(!ownerId)return reply(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(ownerId,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return reply(503,{code:'ms_token_unavailable'});
  let lastRequestAt=0;
  const pacedFetch=async(url,options)=>{
   const delay=Math.max(0,120-(Date.now()-lastRequestAt));
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   lastRequestAt=Date.now();
   return fetcher(url,options);
  };
  const findings=[];
  // First validate ONE operation-report request. Do not repeat an
  // account-wide 412 across eight items.
  const first=await getReport(pacedFetch,env.MS_API_TOKEN,TARGETS[0]);
  findings.push(first);
  if(first.complete===true){
   for(let i=1;i<TARGETS.length;i++){
    const next=await getReport(pacedFetch,env.MS_API_TOKEN,TARGETS[i]);
    findings.push(next);
    if(next.complete!==true)break;
   }
  }
  return reply(200,{
   code:'ms_negative_stock_document_causes',readOnly:true,
   changedRecords:0,checkedAt:new Date().toISOString(),
   checkedItems:findings.length,requestedItems:TARGETS.length,
   completeTargetSet:findings.length===TARGETS.length,
   allMovementPagesComplete:findings.length===TARGETS.length&&findings.every(item=>item.complete===true),
   results:findings,
   interpretation:'Operation turnover is read-only. Check same-stock warehouse and real inflow/outflow events; a negative balance cannot identify the root cause without confirming document totals.'
  });
 };
}
export const onRequestGet=createNegativeCausesAudit();
