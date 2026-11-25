import {verifySession} from '../auth/session.js';

// Diagnostic only. Document-linked stock report for selected owner-confirmed
// negative items. Does not correct stock, modify documents or infer blame.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/negative-stock-causes';
const API='https://api.moysklad.ru/api/remap/1.2/';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const TARGETS=Object.freeze([
 {name:'ПЛЕНКА',code:'728562248',id:'f3974a16-3845-11f1-0a80-1d900001798c',unit:'шт',stock:-991},
 {name:'СПАНБОНД ЧЕРНЫЙ',code:'728562249',id:'fdafcb03-3845-11f1-0a80-0e8e0001aa8c',unit:'шт',stock:-991},
 {name:'Кант (Черный)',code:'017',id:'112c76ea-1b88-11f1-0a80-096400296a5d',unit:null,stock:-1325.5},
 {name:'Липучка жесткая 25мм',code:'728562180',id:'cfd25ff1-1ac3-11f1-0a80-16a500223fe0',unit:'м',stock:-987.5},
 {name:'Крючки',code:'728562177',id:'7e417513-1ac3-11f1-0a80-138a0021749f',unit:'шт',stock:-1012},
 {name:'Экокожа Pegas, перфорация 5x5',code:'728562139',id:'94b23b10-f6af-11f0-0a80-1a6b000a8898',unit:'м',stock:-26.4},
 {name:'Крой Веста, алькантара белый квадрат',code:'728562174',id:'47529d78-1ac2-11f1-0a80-03820020cb93',unit:'шт',stock:-9},
 {name:'ОТПРАВКА ЯНДЕКС',code:'00044',id:'42ac948d-b4e5-11f0-0a80-159c0029f227',unit:'шт',stock:-556}
]);
const str=(x,max=140)=>typeof x==='string'&&x.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(x)?x:null;
const number=x=>typeof x==='number'&&Number.isFinite(x)&&
 Math.abs(x)<1000000000?x:null;
async function getReport(fetcher,token,item){
 const url=new URL(API+'report/byoperations/stock');
 url.searchParams.set('limit','100');
 url.searchParams.set('offset','0');
 url.searchParams.set('filter','assortment='+API+'entity/product/'+item.id);
 let res;
 try{res=await fetcher(url.toString(),{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(16000)})}catch{
  return {...item,status:'api_transport_error',documents:[]};
 }
 if(res.status!==200){
  await res.body?.cancel().catch(()=>{});
  return {...item,status:res.status===429?'rate_limited':
   res.status===403?'permission_denied':
   res.status===401?'token_rejected':
   res.status===400?'filter_rejected':'upstream_error',
   http:res.status,documents:[]};
 }
 try{
  const raw=await res.text();
  if(raw.length>450000)
   return {...item,status:'response_too_large',documents:[]};
  const data=JSON.parse(raw);
  if(!Array.isArray(data?.rows)||!Number.isSafeInteger(data?.meta?.size))
   return {...item,status:'unexpected_api_shape',documents:[],
    responseKeys:Object.keys(data||{}).slice(0,12)};
  if(data.rows.length>100||data.rows.length>data.meta.size)
   return {...item,status:'unexpected_pagination',documents:[]};
  const count={};
  const documents=data.rows.map(row=>{
   const operation=row?.operation;
   const type=str(operation?.meta?.type,45)||
    str(row?.operationType,45)||str(row?.type,45);
   if(type)count[type]=(count[type]||0)+1;
   const date=str(operation?.moment,40)||
    str(row?.moment,40)||str(row?.date,40);
   return {
    documentType:type,
    documentNumber:str(operation?.name,80)||str(operation?.number,80)||
     str(row?.name,80),
    date,
    store:str(row?.store?.name,100)||
     str(operation?.store?.name,100)||null,
    // These are exposed as diagnostics only. Different report schemas
    // have different interpretations of stock/balance vs quantity.
    fields:{
     stock:number(row?.stock),
     quantity:number(row?.quantity),
     incoming:number(row?.incoming),
     outgoing:number(row?.outgoing),
     stockBefore:number(row?.stockBefore),
     stockAfter:number(row?.stockAfter)
    }
   };
  });
  return {...item,status:data.meta.size===data.rows.length?
   'document_list_complete':'document_list_first_100_only',
   documentCount:data.meta.size,readCount:data.rows.length,
   countByDocumentType:count,documents:documents.slice(0,70),
   columnsPresent:data.rows.length?
    Object.keys(data.rows[0]).slice(0,25):[],
   caution:'Reported stock and quantity fields may represent balances, not individual consumption. No causality is proven without full document records.'};
 }catch{return {...item,status:'invalid_upstream_json',documents:[]};}
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
  const findings=[];
  // Small batches, avoid spiking the API; abort after rate limit.
  for(let i=0;i<TARGETS.length;i+=2){
   const pair=await Promise.all(TARGETS.slice(i,i+2).map(item=>
    getReport(fetcher,env.MS_API_TOKEN,item)));
   findings.push(...pair);
   if(pair.some(x=>x.status==='rate_limited'))break;
  }
  return reply(200,{
   code:'ms_negative_stock_document_causes',readOnly:true,
   changedRecords:0,checkedAt:new Date().toISOString(),
   checkedItems:findings.length,requestedItems:TARGETS.length,
   completeTargetSet:findings.length===TARGETS.length,
   results:findings,
   interpretation:'Look for missing incoming documents, wrong source warehouse, production double deductions, and shipment placeholder goods. A negative balance alone cannot identify the cause.'
  });
 };
}
export const onRequestGet=createNegativeCausesAudit();
