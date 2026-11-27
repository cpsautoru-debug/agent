import {verifySession} from '../auth/session.js';
import {createMsReadClient} from './ms-sales-read-client.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/ms-sales-directory';
const TYPES=['counterparty','saleschannel','organization','store','assortment'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply=(status,data)=>new Response(JSON.stringify({readOnly:true,changedRecords:0,...data}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'}});
export async function directoryPage(read,type,offset=0){
 if(!TYPES.includes(type)||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw Error('invalid_scope');
 const data=await read('entity/'+type+'?'+new URLSearchParams({limit:'25',offset:String(offset)}));
 const rows=data?.rows,size=data?.meta?.size;
 if(!Array.isArray(rows)||!Number.isSafeInteger(size)||size<0||rows.length!==Math.min(25,Math.max(0,size-offset)))throw Error('directory_page_unverified');
 const items=rows.map(row=>{
  if(type==='assortment'){
   const kind=row?.meta?.type;
   if(!UUID.test(row?.id||'')||!['product','variant','bundle','service'].includes(kind)||row.meta.href!=='https://api.moysklad.ru/api/remap/1.2/entity/'+kind+'/'+row.id||typeof row.name!=='string'||row.name.length>250)throw Error('directory_entity_unverified');
   const field=v=>typeof v==='string'&&v.length<=250?v:null;
   const barcodes=Array.isArray(row.barcodes)?[...new Set(row.barcodes.flatMap(b=>typeof b==='string'?[b]:['ean13','ean8','code128','upc','gtin','code39'].map(k=>b?.[k])).filter(v=>typeof v==='string'&&v.length<=100))]:[];
   return {id:row.id.toLowerCase(),name:row.name,archived:row.archived===true,itemType:kind,article:field(row.article),code:field(row.code),barcodes,updated:field(row.updated),characteristics:Array.isArray(row.characteristics)?row.characteristics.map(c=>({name:field(c?.name),value:field(c?.value)})).filter(c=>c.name&&c.value!==null):[]};
  }
  if(!UUID.test(row?.id||'')||typeof row.name!=='string'||row.name.length>250||row.meta?.href!=='https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+row.id)throw Error('directory_entity_unverified');
  return {id:row.id,name:row.name,archived:row.archived===true};
 });
 return {type,total:size,items,nextOffset:offset+rows.length<size?offset+rows.length:null,complete:offset===0&&rows.length===size};
}
export function createMsSalesDirectory({fetcher=fetch}={}){
 return async({request,env})=>{
  const url=new URL(request.url);
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||[...url.searchParams.keys()].some(k=>!['type','offset'].includes(k))||url.searchParams.getAll('type').length!==1||url.searchParams.getAll('offset').length>1)return reply(400,{code:'invalid_scope'});
  const type=url.searchParams.get('type'),raw=url.searchParams.get('offset')??'0';
  if(!TYPES.includes(type)||!/^\d{1,5}$/.test(raw)||Number(raw)>10000)return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB||!env.MS_API_TOKEN)return reply(503,{code:'directory_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return reply(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
   return reply(200,{code:'directory_ok',...await directoryPage(createMsReadClient({token:env.MS_API_TOKEN,fetcher}),type,Number(raw))});
  }catch{return reply(503,{code:'directory_read_failed'});}
 };
}
export const onRequest=createMsSalesDirectory();
