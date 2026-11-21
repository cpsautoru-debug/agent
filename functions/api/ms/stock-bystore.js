import {verifySession} from '../auth/session.js';

// One bounded report page plus one bounded assortment name lookup.
// Never follow upstream links, infer quantities, or mutate MoySklad data.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/stock-bystore';
const REPORT='https://api.moysklad.ru/api/remap/1.2/report/stock/bystore';
const ASSORTMENT='https://api.moysklad.ru/api/remap/1.2/entity/assortment';
const LIMIT=10;
const MAX_OFFSET=4990;
const SEARCH=/^[\p{L}\p{N} .,_+\-/()]{2,60}$/u;
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ITEM_PATH=new RegExp('^/api/remap/1\\.2/entity/(product|variant)/('+UUID+')$','i');
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000000000;
const safeText=(value,max)=>typeof value==='string'&&value.trim().length>0&&
  value.length<=max?value.trim():null;
function identity(href){
  if(typeof href!=='string'||href.length>400)return null;
  try{
    const url=new URL(href);
    const match=ITEM_PATH.exec(url.pathname);
    return url.origin==='https://api.moysklad.ru'&&match?
      {type:match[1].toLowerCase(),id:match[2].toLowerCase()}:null;
  }catch{return null;}
}
export function parseStockScope(url){
  if(url.origin!==OFFICE||url.pathname!==PATH||url.hash)throw Error('invalid_stock_scope');
  const keys=[...url.searchParams.keys()];
  if(keys.some(k=>k!=='offset'&&k!=='search')||
    keys.filter(k=>k==='offset').length>1||
    keys.filter(k=>k==='search').length>1)throw Error('invalid_stock_scope');
  const rawOffset=url.searchParams.get('offset');
  if(rawOffset!==null&&!/^(0|[1-9]\d{0,3})$/.test(rawOffset))
    throw Error('invalid_stock_scope');
  const offset=rawOffset===null?0:Number(rawOffset);
  if(offset>MAX_OFFSET||offset%LIMIT!==0)throw Error('invalid_stock_scope');
  const rawSearch=url.searchParams.get('search');
  if(rawSearch!==null&&(rawSearch!==rawSearch.trim()||!SEARCH.test(rawSearch)||
    /\s{2}/.test(rawSearch)))throw Error('invalid_stock_scope');
  return {offset,search:rawSearch};
}
export function buildStockUrl(scope){
  const url=new URL(REPORT);
  url.searchParams.set('limit',String(LIMIT));
  url.searchParams.set('offset',String(scope.offset));
  url.searchParams.set('groupBy','variant');
  if(scope.search!==null)url.searchParams.set('filter','search='+scope.search);
  return url.toString();
}
export function buildNamesUrl(ids){
  if(!Array.isArray(ids)||ids.length<1||ids.length>LIMIT||
    ids.some(x=>typeof x!=='string'||!new RegExp('^'+UUID+'$','i').test(x))||
    new Set(ids).size!==ids.length)throw Error('stock_unverified');
  const url=new URL(ASSORTMENT);
  url.searchParams.set('limit',String(LIMIT));
  url.searchParams.set('filter',ids.map(id=>'id='+id).join(';'));
  return url.toString();
}
async function boundedJson(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('stock_unverified');
  let bytes=0,value='';
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const chunk=await reader.read();
      if(chunk.done){value+=decoder.decode();break;}
      bytes+=chunk.value.byteLength;
      if(bytes>256*1024)throw Error('stock_unverified');
      value+=decoder.decode(chunk.value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(value);}catch{throw Error('stock_unverified');}
}
export function extractStockIds(payload,scope){
  const count=payload?.meta?.size;
  if(!Number.isSafeInteger(count)||count<0||count>10000000||
    !Array.isArray(payload?.rows)||payload.rows.length>LIMIT||
    (payload.rows.length===0&&scope.offset<count)||
    scope.offset+payload.rows.length>count)
    throw Error('stock_unverified');
  const found=new Set();
  for(const row of payload.rows){
    const entry=identity(row?.meta?.href);
    if(!entry||!Array.isArray(row?.stockByStore)||row.stockByStore.length>30||
      found.has(entry.id))throw Error('stock_unverified');
    found.add(entry.id);
  }
  return [...found];
}
export function extractNames(payload,ids){
  if(!Array.isArray(payload?.rows)||payload.rows.length>LIMIT||
    !Number.isSafeInteger(payload?.meta?.size)||payload.meta.size<0)
    throw Error('stock_unverified');
  const allowed=new Set(ids);
  const names=new Map();
  for(const row of payload.rows){
    const id=typeof row?.id==='string'?row.id.toLowerCase():null;
    if(!id||!allowed.has(id)||names.has(id))
      throw Error('stock_unverified');
    names.set(id,{
      name:safeText(row.name,180),
      code:safeText(row.code,70),
      uom:safeText(row.uom?.name,50)||safeText(row.uomName,50),
      // Actual read-only product folder path; not an inferred material category.
      catalogPath:safeText(row.pathName,180)
    });
  }
  return names;
}
export function summarizeStockByStore(payload,scope,names=new Map()){
  const ids=extractStockIds(payload,scope);
  const items=payload.rows.map(row=>{
    const entry=identity(row.meta.href);
    if(!ids.includes(entry.id))throw Error('stock_unverified');
    const details=names.get(entry.id);
    const seen=new Set();
    const stores=row.stockByStore.map(store=>{
      const name=safeText(store?.name,120);
      if(!name||seen.has(name))throw Error('stock_unverified');
      seen.add(name);
      for(const field of ['stock','reserve','inTransit']){
        if(store[field]!==undefined&&store[field]!==null&&!finite(store[field]))
          throw Error('stock_unverified');
      }
      return {
        name,
        stock:finite(store.stock)?store.stock:null,
        reserve:finite(store.reserve)?store.reserve:null,
        inTransit:finite(store.inTransit)?store.inTransit:null
      };
    });
    return {
      name:details?.name||null,
      code:details?.code||null,
      uom:details?.uom||null,
      catalogPath:details?.catalogPath||null,
      stores
    };
  });
  const warehouses=[...new Set(items.flatMap(item=>item.stores.map(s=>s.name)))];
  return {
    code:'ms_stock_bystore_ok',source:'MOYSKLAD_STOCK_BYSTORE_AND_ASSORTMENT',
    readOnly:true,requests:ids.length?2:1,changedRecords:0,
    scope:'PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY',
    totalAssortmentReportRows:payload.meta.size,offset:scope.offset,pageSize:LIMIT,
    search:scope.search,
    hasMore:scope.offset+items.length<payload.meta.size&&scope.offset+LIMIT<=MAX_OFFSET,
    warehousesInPage:warehouses,
    namesResolved:items.filter(x=>x.name!==null).length,
    items
  };
}
export function createStockHandler(fetcher=fetch){
  return async function({request,env}){
    try{
      if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
      let scope;
      try{scope=parseStockScope(new URL(request.url));}
      catch{return json(400,{code:'invalid_stock_scope'});}
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
        return json(503,{code:'owner_auth_unavailable'});
      const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!sub)return json(401,{code:'owner_session_required'});
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'owner_only'});
      if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
        /\s/.test(env.MS_API_TOKEN))return json(503,{code:'ms_token_unavailable'});

      let upstream='stockbystore';
      try{
        const get=async url=>{
          const response=await fetcher(url,{method:'GET',redirect:'manual',
            headers:{
              Authorization:'Bearer '+env.MS_API_TOKEN,
              Accept:'application/json;charset=utf-8'
            },signal:AbortSignal.timeout(25000)});
          if(response.status!==200){
            await response.body?.cancel().catch(()=>{});
            const err=Error(response.status===401?'ms_token_rejected':
              response.status===403?'ms_stock_permission_denied':
              response.status===429?'ms_rate_limited':'ms_stock_upstream_error');
            err.http=response.status;
            throw err;
          }
          return boundedJson(response);
        };
        const report=await get(buildStockUrl(scope));
        const ids=extractStockIds(report,scope);
        let names=new Map();
        if(ids.length){
          upstream='assortment';
          names=extractNames(await get(buildNamesUrl(ids)),ids);
        }
        return json(200,{...summarizeStockByStore(report,scope,names),upstreamHttp:200});
      }catch(error){
        const allowed=['ms_token_rejected','ms_stock_permission_denied',
          'ms_rate_limited','ms_stock_upstream_error','stock_unverified'];
        return json(502,{
          code:allowed.includes(error?.message)?
            error.message==='stock_unverified'?'ms_stock_unverified':error.message:
            error?.name==='TimeoutError'?'ms_stock_timeout':'ms_stock_transport_error',
          upstream,upstreamHttp:Number.isInteger(error?.http)&&error.http>=300&&
            error.http<=599?error.http:null,
          readOnly:true,changedRecords:0
        });
      }
    }catch{
      return json(503,{code:'ms_stock_unavailable',readOnly:true,changedRecords:0});
    }
  };
}
export const onRequestGet=createStockHandler();
