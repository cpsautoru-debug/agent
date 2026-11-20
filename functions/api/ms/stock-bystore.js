import {verifySession} from '../auth/session.js';

// Strictly read-only, paged MoySklad stock report.
// Stock is physical quantity; reserve/inTransit are distinct and must not be summed.
// A missing store or quantity never means zero.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/stock-bystore';
const REPORT='https://api.moysklad.ru/api/remap/1.2/report/stock/bystore';
const LIMIT=10;
const MAX_OFFSET=4990;
const SEARCH=/^[\p{L}\p{N}\s.,_+\-/()]{2,60}$/u;
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000000000;
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&
  value.length<=max?value.trim():null;

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
  // The documented stock-by-store filter uses 'search'. No user-provided
  // URLs, warehouse IDs, extra query parameters, or raw filter expressions.
  if(scope.search!==null)url.searchParams.set('filter','search='+scope.search);
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
export function summarizeStockByStore(payload,scope){
  const count=payload?.meta?.size;
  if(!Number.isSafeInteger(count)||count<0||count>10000000||
    !Array.isArray(payload?.rows)||payload.rows.length>LIMIT||
    (payload.rows.length===0&&scope.offset<count)||
    scope.offset>count&&payload.rows.length!==0)
    throw Error('stock_unverified');
  const items=payload.rows.map(row=>{
    if(!row||!Array.isArray(row.stockByStore)||row.stockByStore.length>30)
      throw Error('stock_unverified');
    const seen=new Set();
    const stores=row.stockByStore.map(store=>{
      const name=text(store?.name,120);
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
      name:text(row.name,180)||text(row.positionName,180),
      code:text(row.code,70),
      uom:text(row.uomName,50)||text(row.uom?.name,50),
      stores
    };
  });
  const warehouses=[...new Set(items.flatMap(item=>item.stores.map(s=>s.name)))];
  return {
    code:'ms_stock_bystore_ok',source:'MOYSKLAD_STOCK_BYSTORE',
    readOnly:true,requests:1,changedRecords:0,
    scope:'PAGE_OF_ASSORTMENT_NOT_COMPLETE_WAREHOUSE_INVENTORY',
    totalAssortmentReportRows:count,offset:scope.offset,pageSize:LIMIT,
    search:scope.search,
    hasMore:scope.offset+items.length<count&&scope.offset+LIMIT<=MAX_OFFSET,
    warehousesInPage:warehouses,
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
      let response;
      try{
        response=await fetcher(buildStockUrl(scope),{
          method:'GET',redirect:'manual',
          headers:{
            Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json;charset=utf-8'
          },
          signal:AbortSignal.timeout(25000)
        });
      }catch(error){
        return json(502,{code:error?.name==='TimeoutError'?
          'ms_stock_timeout':'ms_stock_transport_error',readOnly:true,changedRecords:0});
      }
      if(response.status!==200){
        await response.body?.cancel().catch(()=>{});
        return json(502,{
          code:response.status===401?'ms_token_rejected':
            response.status===403?'ms_stock_permission_denied':
            response.status===429?'ms_rate_limited':'ms_stock_upstream_error',
          upstreamHttp:Number.isInteger(response.status)?response.status:null,
          readOnly:true,changedRecords:0
        });
      }
      try{
        return json(200,{...summarizeStockByStore(await boundedJson(response),scope),upstreamHttp:200});
      }catch{
        return json(502,{code:'ms_stock_unverified',readOnly:true,changedRecords:0});
      }
    }catch{
      return json(503,{code:'ms_stock_unavailable',readOnly:true,changedRecords:0});
    }
  };
}
export const onRequestGet=createStockHandler();
