import {verifySession} from '../auth/session.js';

// Read-only owner-triggered SKU crosswalk and accounting stock evidence.
// This is NOT pickable physical inventory and never creates MoySklad documents.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const ROUTE='/api/ms/orders-stock-match';
const ROOT='https://api.moysklad.ru/api/remap/1.2/';
const MAX_SKUS=20,PER_PAGE=100,MAX_PAGES=12,MAX_BYTES=600000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const json=(status,payload)=>new Response(JSON.stringify(payload),{status,headers:HEADERS});
const safeSku=v=>typeof v==='string'&&v.length>0&&v.length<=100&&v.trim()===v&&
 !/[\u0000-\u001f\u007f]/.test(v);
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e9?x:null;
const extractId=href=>{
 if(typeof href!=='string')return null;
 try{const u=new URL(href);
  const m=/^\/api\/remap\/1\.2\/entity\/(?:product|variant|bundle)\/([a-f0-9-]{36})$/i.exec(u.pathname);
  return u.origin==='https://api.moysklad.ru'&&m&&UUID.test(m[1])?m[1].toLowerCase():null;
 }catch{return null;}
};
async function boundedJson(response){
 const reader=response.body?.getReader();if(!reader)throw Error('missing_body');
 const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
 try{for(;;){const {done,value}=await reader.read();
  if(done){raw+=decoder.decode();break;}
  bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('response_too_large');
  raw+=decoder.decode(value,{stream:true});
 }}finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(raw);
}
async function pages(fetcher,token,path){
 const rows=[];let expected=null;
 for(let p=0;p<MAX_PAGES;p++){
  const url=new URL(ROOT+path);url.searchParams.set('limit',String(PER_PAGE));
  url.searchParams.set('offset',String(p*PER_PAGE));
  const res=await fetcher(url.toString(),{method:'GET',redirect:'manual',
   headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
   signal:AbortSignal.timeout(18000)});
  if(res.status!==200){await res.body?.cancel().catch(()=>{});
   const error=Error(res.status===429?'rate_limited':
    res.status===401?'token_rejected':res.status===403?'permission_denied':'upstream_rejected');
   error.http=res.status;throw error;}
  const body=await boundedJson(res);
  if(!Number.isSafeInteger(body?.meta?.size)||body.meta.size<0||
   !Array.isArray(body.rows)||body.rows.length>PER_PAGE||
   (expected!==null&&expected!==body.meta.size))throw Error('snapshot_unverified');
  if(expected===null)expected=body.meta.size;
  if(body.rows.length!==Math.min(PER_PAGE,Math.max(0,expected-rows.length)))
   throw Error('snapshot_incomplete');
  rows.push(...body.rows);
  if(rows.length===expected)return {rows,pages:p+1};
 }
 throw Error('snapshot_limit');
}
export function matchOrdersStock(skus,assortment,stock){
 if(!Array.isArray(skus)||!Array.isArray(assortment)||!Array.isArray(stock)||
   skus.length>MAX_SKUS||skus.some(x=>!safeSku(x)))throw Error('invalid_input');
 const bySku=new Map(skus.map(s=>[s,new Map()]));
 for(const item of assortment){
  const id=typeof item?.id==='string'&&UUID.test(item.id)?item.id.toLowerCase():null;
  if(!id)continue;
  for(const sku of skus){
   if(item.article===sku||item.code===sku){
    const existing=bySku.get(sku).get(id);
    bySku.get(sku).set(id,{id,
     name:typeof item.name==='string'?item.name.slice(0,150):null,
     matchFields:[...new Set([...(existing?.matchFields||[]),
      ...(item.article===sku?['article']:[]),...(item.code===sku?['code']:[])])]});
   }
  }
 }
 const byId=new Map();
 for(const r of stock){
  const id=extractId(r?.meta?.href);if(!id)continue;
  if(byId.has(id))throw Error('stock_duplicate_item');
  if(!Array.isArray(r.stockByStore))throw Error('stock_stores_unverified');
  const stores=r.stockByStore.map(v=>{
   if(typeof v?.name!=='string'||v.name.length>120||
     num(v.stock)===null||num(v.reserve)===null)throw Error('stock_stores_unverified');
   return {store:v.name,stock:v.stock,reserve:v.reserve,
    accountingFree:v.stock-v.reserve};
  });
  byId.set(id,stores);
 }
 return skus.map(sku=>{
  const candidates=[...bySku.get(sku).values()];
  if(candidates.length!==1)return {sku,status:candidates.length===0?'not_matched':'ambiguous',
   candidates:candidates.length,stores:[],itemName:null,accountingTotal:null};
  const c=candidates[0],stores=byId.get(c.id);
  return {sku,status:stores?'matched_stock_report':'matched_stock_unknown',
   candidates:1,matchFields:c.matchFields,itemId:c.id,itemName:c.name,
   stores:stores||[],accountingTotal:stores?stores.reduce((n,x)=>n+x.stock,0):null};
 });
}
// Two exact catalogue lookups per SKU instead of downloading the entire
// assortment (which can exceed the response cap because of embedded stocks).
// Stock report is also filtered to the uniquely resolved product/variant.
async function requestSmall(fetcher,token,url){
 const res=await fetcher(url.toString(),{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8',
   'X-Lognex-Remap-Beta-Feature':'assortmentWithoutStock'},
  signal:AbortSignal.timeout(12000)});
 if(res.status!==200){
  await res.body?.cancel().catch(()=>{});
  const err=Error(res.status===429?'rate_limited':res.status===401?'token_rejected':
   res.status===403?'permission_denied':res.status===400||res.status===412?
   'filter_rejected':'upstream_rejected');err.http=res.status;throw err;
 }
 const body=await boundedJson(res);
 if(!Array.isArray(body?.rows)||!Number.isSafeInteger(body.meta?.size)||
   body.meta.size<0||body.rows.length>2)throw Error('snapshot_unverified');
 return body;
}
async function targetedSku(fetcher,token,sku){
 const found=new Map();
 for(const field of ['article','code']){
  const url=new URL(ROOT+'entity/assortment');
  url.searchParams.set('filter',field+'='+sku);
  url.searchParams.set('limit','2');
  const data=await requestSmall(fetcher,token,url);
  if(data.meta.size>data.rows.length)
   return {sku,status:'ambiguous',candidates:data.meta.size,stores:[],
    accountingTotal:null,itemName:null};
  for(const a of data.rows){
   if(a?.[field]!==sku||typeof a?.id!=='string'||!UUID.test(a.id))
    throw Error('snapshot_unverified');
   const id=a.id.toLowerCase();
   const name=typeof a.name==='string'?a.name.slice(0,150):null;
   const entityType=typeof a?.meta?.href==='string'?
    new URL(a.meta.href).pathname.match(/\/entity\/(product|variant)\//)?.[1]:null;
   if(!entityType)throw Error('unsupported_item_type');
   const earlier=found.get(id);
   found.set(id,{id,name,type:entityType,matchFields:[
    ...(earlier?.matchFields||[]),field]});
  }
 }
 if(found.size!==1)return {sku,status:found.size?'ambiguous':'not_matched',
  candidates:found.size,stores:[],accountingTotal:null,itemName:null};
 const item=[...found.values()][0];
 const url=new URL(ROOT+'report/stock/bystore');
 url.searchParams.set('filter',item.type+'='+ROOT+'entity/'+item.type+'/'+item.id);
 url.searchParams.set('limit','2');
 const data=await requestSmall(fetcher,token,url);
 const strictRows=data.rows.filter(row=>extractId(row?.meta?.href)===item.id);
 if(data.meta.size>2||strictRows.length>1)throw Error('stock_duplicate_item');
 if(data.rows.some(row=>extractId(row?.meta?.href)!==item.id))
  throw Error('stock_filter_unverified');
 const row=strictRows[0];
 if(!row||!Array.isArray(row.stockByStore))
  return {sku,status:'matched_stock_unknown',candidates:1,stores:[],
   itemName:item.name,itemId:item.id,accountingTotal:null,
   matchFields:item.matchFields};
 const stores=row.stockByStore.map(v=>{
  if(typeof v?.name!=='string'||v.name.length>120||
    num(v.stock)===null||num(v.reserve)===null)throw Error('stock_stores_unverified');
  return {store:v.name,stock:v.stock,reserve:v.reserve,
   accountingFree:v.stock-v.reserve};
 });
 return {sku,status:'matched_stock_report',candidates:1,itemId:item.id,
  itemName:item.name,matchFields:item.matchFields,stores,
  accountingTotal:stores.reduce((a,v)=>a+v.stock,0)};
}

export function createOrderStockMatch({fetcher=fetch}={}){
 return async({request,env})=>{
  if(request.method!=='POST')return json(405,{code:'method_not_allowed'});
  const u=new URL(request.url);
  if(u.origin!==ORIGIN||u.pathname!==ROUTE||u.search||u.hash)
   return json(400,{code:'invalid_scope'});
  if(request.headers.get('Origin')!==ORIGIN||
   request.headers.get('Sec-Fetch-Site')==='cross-site')
   return json(403,{code:'origin_not_allowed'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
   return json(503,{code:'owner_auth_unavailable'});
  const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
  if(!sub)return json(401,{code:'owner_session_required'});
  try{const o=await env.OZON_FINANCE_DB.prepare(
   "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
  ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();if(o?.allowed!==1)return json(403,{code:'owner_only'});}
  catch{return json(503,{code:'owner_auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
   return json(503,{code:'ms_token_unavailable'});
  let input;
  try{if(Number(request.headers.get('content-length'))>4096)throw Error();
   input=await request.json();
   if(!input||Object.keys(input).length!==1||!Array.isArray(input.skus)||
    input.skus.length<1||input.skus.length>MAX_SKUS||
    input.skus.some(x=>!safeSku(x))||new Set(input.skus).size!==input.skus.length)
    throw Error();
  }catch{return json(400,{code:'invalid_sku_batch'});}
  const matches=[];
  for(const sku of input.skus){
   try{
    matches.push(await targetedSku(fetcher,env.MS_API_TOKEN,sku));
   }catch(e){
    const allowed=['rate_limited','token_rejected','permission_denied','filter_rejected',
     'upstream_rejected','snapshot_unverified','stock_duplicate_item',
     'stock_stores_unverified','response_too_large','unsupported_item_type','stock_filter_unverified'];
    const code=allowed.includes(e?.message)?e.message:'stock_match_unavailable';
    matches.push({sku,status:'unverified',reason:code,
     http:Number.isSafeInteger(e?.http)?e.http:null,stores:[],accountingTotal:null});
    if(['rate_limited','token_rejected','permission_denied'].includes(code)){
     for(const remaining of input.skus.slice(matches.length))
      matches.push({sku:remaining,status:'unverified',reason:'source_not_checked',
       stores:[],accountingTotal:null});
     break;
    }
   }
  }
  return json(200,{code:'ms_orders_stock_match',readOnly:true,changedRecords:0,
   completeCatalog:false,completeStockReport:false,
   targetedSkuChecks:true,atomicSnapshot:false,readAt:new Date().toISOString(),
   requestedSkus:input.skus.length,matches,
   note:'Exact filters only. Each SKU is independent. Unknown or unavailable stock is not zero. No physical stock or dispatch verified; no writes performed.'});
 };
}
export const onRequestPost=createOrderStockMatch();
