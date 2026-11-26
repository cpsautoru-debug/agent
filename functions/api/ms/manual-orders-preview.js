import {msRef} from '../orders/ms-sales-facts.mjs';
import {verifySession} from '../auth/session.js';

// Read-only feed for manual Avito/dealer customer orders entered in MoySklad.
// Orders are included only when their externalCode has an exact AS63 marker.
// No customer data is returned and no MoySklad/D1 records are written.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/manual-orders-preview';
const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/customerorder';
const LIMIT=100,MAX_PAGES=5,MAX_BYTES=512*1024;
const CHANNELS=[
 {key:'avito',label:'Авито',marker:'AS63:manual:avito:'},
 {key:'dealer_ruslan',label:'Дилер · Руслан',marker:'AS63:manual:dealer_ruslan:'},
 {key:'dealer_irina',label:'Дилер · Ирина',marker:'AS63:manual:dealer_irina:'},
 {key:'plamya',label:'Пламя · точка',marker:'AS63:manual:plamya:'}
];
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
 'Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(s,v)=>new Response(JSON.stringify(v),{status:s,headers:H});
const clean=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n&&
 x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
export function manualOrderChannel(code){
 if(typeof code!=='string'||code.length>255)return null;
 const channel=CHANNELS.find(x=>code.startsWith(x.marker));
 if(!channel)return null;
 const suffix=code.slice(channel.marker.length);
 return suffix.length<=64 && /^[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*$/.test(suffix)?{key:channel.key,label:channel.label,orderRef:suffix}:null;
}
function assortmentId(item){
 const href=item?.meta?.href;
 if(typeof href!=='string')return null;
 try{
  const u=new URL(href),m=/^\/api\/remap\/1\.2\/entity\/(product|variant|bundle)\/([a-f0-9-]{36})$/i.exec(u.pathname);
  return u.origin==='https://api.moysklad.ru'&&m&&ID.test(m[2])?
   {type:m[1],id:m[2].toLowerCase()}:null;
 }catch{return null;}
}
export function normalizeManualCustomerOrder(row){
 const channel=manualOrderChannel(row?.externalCode);
 const positions=Array.isArray(row?.positions)?row.positions:row?.positions?.rows;
 const declaredCount=row?.positions?.meta?.size;
 if(!channel||!ID.test(row?.id||'')||!clean(row?.name,100)||
   !Array.isArray(positions)||positions.length>100||
   (declaredCount!==undefined&&declaredCount!==positions.length))
   throw Error('manual_order_schema_unverified');
 const items=positions.map(p=>{
  const assortment=p?.assortment,ref=assortmentId(assortment);
  if(!ref||!clean(assortment?.name,200)||typeof p.quantity!=='number'||
    !Number.isFinite(p.quantity)||p.quantity<=0||p.quantity>10000)
    throw Error('manual_order_position_unverified');
  return {itemId:ref.id,itemType:ref.type,name:assortment.name,
   article:clean(assortment.article,100)?assortment.article:null,
   code:clean(assortment.code,100)?assortment.code:null,quantity:p.quantity,transaction:{basis:'ms_position_unit_price',amountMinor:Number.isSafeInteger(p.price)&&p.price>=0?p.price:null,currency:null}};
 });
 if(items.length===0)throw Error('manual_order_positions_missing');
 const stateType=['Regular','Successful','Unsuccessful'].includes(row?.state?.stateType)?row.state.stateType:null;
 return {
  source:channel.key,sourceLabel:channel.label,manualOrderRef:channel.orderRef,
  transaction:{scheme:'manual',documentMoment:row.moment,agentId:msRef(row.agent,'counterparty'),organizationId:msRef(row.organization,'organization'),storeId:msRef(row.store,'store'),channelId:msRef(row.salesChannel,'saleschannel'),documentId:row.id},
  externalCode:row.externalCode,documentId:row.id.toLowerCase(),documentName:row.name,
  orderIdentity:'AS63:manual:'+channel.key+':'+row.id.toLowerCase(),
  moment:typeof row.moment==='string'&&row.moment.length<=40?row.moment:null,
  status:clean(row?.state?.name,100)?row.state.name:'Статус не подтверждён',
  statusType:stateType,organization:clean(row?.organization?.name,120)?row.organization.name:null,
  store:clean(row?.store?.name,120)?row.store.name:null,items
 };
}
async function readJson(res){
 const reader=res.body?.getReader();if(!reader)throw Error('response_body_missing');
 const dec=new TextDecoder('utf-8',{fatal:true});let bytes=0,raw='';
 try{for(;;){const {done,value}=await reader.read();if(done){raw+=dec.decode();break;}
  bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('response_too_large');
  raw+=dec.decode(value,{stream:true});}}
 finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(raw);
}
async function readChannel(fetcher,token,channel){
 let expected=null,seen=0,pages=0;const orders=[];
 for(let page=0;page<MAX_PAGES;page++){
  const u=new URL(ROOT);u.searchParams.set('filter','externalCode~'+channel.marker);
  u.searchParams.set('limit',String(LIMIT));u.searchParams.set('offset',String(page*LIMIT));
  u.searchParams.set('expand','positions.assortment,organization,store,state');
  const res=await fetcher(u.toString(),{method:'GET',redirect:'manual',
   headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
   signal:AbortSignal.timeout(18000)});
  if(res.status!==200){await res.body?.cancel().catch(()=>{});return {
   source:channel.key,label:channel.label,complete:false,pages,received:orders.length,
   error:res.status===429?'rate_limited':res.status===401?'token_rejected':
    res.status===403?'permission_denied':'upstream_error'};}
  let body;try{body=await readJson(res);}catch{return {
   source:channel.key,label:channel.label,complete:false,pages,received:orders.length,
   error:'response_unverified'};}
  if(!Array.isArray(body?.rows)||body.rows.length>LIMIT||
   !Number.isSafeInteger(body?.meta?.size)||body.meta.size<0||
   (expected!==null&&expected!==body.meta.size))return {
    source:channel.key,label:channel.label,complete:false,pages,received:orders.length,
    error:'pagination_unverified'};
  if(expected===null)expected=body.meta.size;
  const wanted=Math.min(LIMIT,Math.max(0,expected-seen));
  if(body.rows.length!==wanted)return {
   source:channel.key,label:channel.label,complete:false,pages,received:orders.length,
   error:'pagination_incomplete'};
  try{for(const row of body.rows){
   // Server-side exact-prefix check prevents false-positive substring matches.
   if(manualOrderChannel(row?.externalCode)?.key!==channel.key)continue;
   orders.push(normalizeManualCustomerOrder(row));
  }}catch{return {source:channel.key,label:channel.label,complete:false,pages,
   received:orders.length,error:'document_schema_unverified'};}
  seen+=body.rows.length;pages++;
  if(seen===expected)return {source:channel.key,label:channel.label,complete:true,
   pages,received:orders.length,totalMatches:orders.length,error:null,orders};
 }
 return {source:channel.key,label:channel.label,complete:false,pages,received:orders.length,
  totalMatches:null,error:'page_cap_reached'};
}
async function owner(request,env){
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
  return {status:503,code:'owner_auth_unavailable'};
 let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
 if(!sub)return {status:401,code:'owner_session_required'};
 try{
  const row=await env.OZON_FINANCE_DB.prepare(
   "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1")
   .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
  return row?.allowed===1?{sub}:{status:403,code:'owner_only'};
 }catch{return {status:503,code:'owner_auth_unavailable'};}
}
export function createManualOrdersPreview({fetcher=fetch,authorizeServer=null}={}){
 return async({request,env})=>{
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url);}catch{return json(400,{code:'invalid_scope'});}
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.search||u.hash)return json(400,{code:'invalid_scope'});
  const auth=authorizeServer&&await authorizeServer(request,env)?{sub:'server'}:await owner(request,env);if(!auth.sub)return json(auth.status,{code:auth.code});
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
   return json(503,{code:'ms_token_unavailable'});
  const channels=[];
  for(const channel of CHANNELS){
   const result=await readChannel(fetcher,env.MS_API_TOKEN,channel);
   channels.push(result);
   if(result.error==='rate_limited')break;
  }
  const orders=channels.filter(x=>x.complete).flatMap(x=>x.orders);
  const codes=new Map();for(const order of orders)codes.set(order.externalCode,(codes.get(order.externalCode)||0)+1);
  const duplicates=[...codes].filter(([,n])=>n>1).map(([code,count])=>({externalCode:code,count}));
  return json(200,{code:'manual_orders_preview_ok',readOnly:true,changedRecords:0,
   approvedForWrite:false,complete:channels.length===CHANNELS.length&&channels.every(x=>x.complete),
   channels:channels.map(({orders:omit,...x})=>x),orders,duplicateExternalCodes:duplicates,
   duplicateCount:duplicates.length,sampledAt:new Date().toISOString(),
   note:'Customer orders and stock were not changed. Items link to MoySklad by assortment UUID.'});
 };
}
export const onRequestGet=createManualOrdersPreview();
