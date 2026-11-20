import {verifySession} from '../auth/session.js';
import {buildNamesUrl,extractNames} from './stock-bystore.js';

// One warehouse-specific, READ-ONLY "current" report. No D1 writes or background crawl.
// This report returns only non-zero positions by default. It is NOT full inventory.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const ROUTE='/api/ms/warehouse-availability';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const STORES=BASE+'entity/store';
const CURRENT=BASE+'report/stock/bystore/current';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_NAME=/^[\p{L}\p{N} .,_\-–—()]{3,120}$/u;
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const text=(v,max)=>typeof v==='string'&&v===v.trim()&&
  v.length>0&&v.length<=max?v:null;
const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9;

export function parseWarehouseScope(url){
  if(url.origin!==OFFICE||url.pathname!==ROUTE||url.hash)throw Error('invalid_warehouse_scope');
  const keys=[...url.searchParams.keys()];
  if(keys.length!==1||keys[0]!=='store')throw Error('invalid_warehouse_scope');
  const name=url.searchParams.get('store');
  if(!name||!STORE_NAME.test(name)||name!==name.trim()||/\s{2}/.test(name))
    throw Error('invalid_warehouse_scope');
  return {store:name};
}
export function buildCurrentWarehouseUrl(storeId){
  if(typeof storeId!=='string'||!UUID.test(storeId))throw Error('warehouse_unverified');
  const url=new URL(CURRENT);
  url.searchParams.set('stockType','stock');
  url.searchParams.set('filter','storeId='+storeId);
  return url.toString();
}
async function boundedJson(response,limit=256*1024){
  const reader=response.body?.getReader();
  if(!reader)throw Error('warehouse_unverified');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,raw='';
  try{
    while(true){
      const part=await reader.read();
      if(part.done){raw+=decoder.decode();break;}
      size+=part.value.byteLength;
      if(size>limit)throw Error('warehouse_unverified');
      raw+=decoder.decode(part.value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(raw);}catch{throw Error('warehouse_unverified');}
}
export function findStore(payload,name){
  if(!Array.isArray(payload?.rows)||!Number.isSafeInteger(payload?.meta?.size)||
    payload.meta.size>50||payload.meta.size<0||
    payload.rows.length!==payload.meta.size)
    throw Error('warehouse_unverified');
  const found=payload.rows.filter(store=>store?.name===name);
  if(found.length!==1||typeof found[0].id!=='string'||!UUID.test(found[0].id))
    throw Error('warehouse_not_found_or_ambiguous');
  return {id:found[0].id.toLowerCase(),name};
}
export function parseCurrentStock(payload,storeId){
  if(!Array.isArray(payload)||payload.length>500||!UUID.test(storeId))
    throw Error('warehouse_unverified');
  const found=new Set();
  const lines=[];
  for(const record of payload){
    const id=text(record?.assortmentId,36);
    const warehouse=text(record?.storeId,36);
    if(!id||!UUID.test(id)||!warehouse||warehouse.toLowerCase()!==storeId.toLowerCase()||
      found.has(id.toLowerCase())||
      (record.stock!==null&&record.stock!==undefined&&!number(record.stock)))
      throw Error('warehouse_unverified');
    found.add(id.toLowerCase());
    lines.push({id:id.toLowerCase(),stock:number(record.stock)?record.stock:null});
  }
  return lines;
}
export function summarizeWarehouseAvailability(lines,names,store){
  if(!Array.isArray(lines)||lines.length>500||!(names instanceof Map))
    throw Error('warehouse_unverified');
  const visible=lines.slice(0,10).map(line=>({
    name:names.get(line.id)?.name||null,
    code:names.get(line.id)?.code||null,
    uom:names.get(line.id)?.uom||null,
    stock:line.stock
  }));
  return {
    code:'ms_warehouse_availability_ok',readOnly:true,changedRecords:0,
    source:'MOYSKLAD_BYSTORE_CURRENT_NONZERO',stockType:'stock',
    scope:'WAREHOUSE_NONZERO_POSITIONS_ONLY_NOT_FULL_INVENTORY',
    warehouseName:store.name,warehouseLines:lines.length,
    positiveRows:lines.filter(x=>x.stock!==null&&x.stock>0).length,
    negativeRows:lines.filter(x=>x.stock!==null&&x.stock<0).length,
    zeroRows:lines.filter(x=>x.stock===0).length,
    unknownRows:lines.filter(x=>x.stock===null).length,
    items:visible,
    namesResolved:visible.filter(x=>x.name!==null).length,
    displayedCount:visible.length,additionalRows:Math.max(0,lines.length-visible.length)
  };
}
export function createWarehouseAvailabilityHandler(fetcher=fetch){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let scope;
    try{scope=parseWarehouseScope(new URL(request.url));}
    catch{return json(400,{code:'invalid_warehouse_scope'});}
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    let ownerSub;
    try{ownerSub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return json(401,{code:'owner_session_required'});}
    if(!ownerSub)return json(401,{code:'owner_session_required'});
    let owner=null;
    try{
      owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(ownerSub,env.OFFICE_ALLOWED_EMAIL).first();
    }catch{return json(503,{code:'owner_auth_unavailable'});}
    if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
      return json(503,{code:'ms_token_unavailable'});
    let upstream='stores';
    try{
      const get=async(url,cap)=>{
        const response=await fetcher(url,{method:'GET',redirect:'manual',
          headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json;charset=utf-8'},
          signal:AbortSignal.timeout(20000)});
        if(response.status!==200){
          await response.body?.cancel().catch(()=>{});
          const error=Error(response.status===429?'ms_rate_limited':
            response.status===401?'ms_token_rejected':
            response.status===403?'ms_warehouse_permission_denied':'ms_warehouse_upstream_error');
          error.upstreamHttp=response.status;
          throw error;
        }
        return boundedJson(response,cap);
      };
      const storeUrl=new URL(STORES);
      storeUrl.searchParams.set('limit','50');
      storeUrl.searchParams.set('offset','0');
      const stores=await get(storeUrl.toString(),64*1024);
      const store=findStore(stores,scope.store);
      upstream='current';
      const lines=parseCurrentStock(await get(buildCurrentWarehouseUrl(store.id),256*1024),store.id);
      let names=new Map();
      if(lines.length){
        upstream='assortment';
        const ids=lines.slice(0,10).map(x=>x.id);
        const namesUrl=buildNamesUrl(ids);
        const data=await get(namesUrl,128*1024);
        names=extractNames(data,ids);
      }
      return json(200,{...summarizeWarehouseAvailability(lines,names,store),
        requests:lines.length?3:2});
    }catch(error){
      const codes=['ms_rate_limited','ms_token_rejected',
        'ms_warehouse_permission_denied','ms_warehouse_upstream_error',
        'warehouse_unverified','warehouse_not_found_or_ambiguous'];
      const raw=codes.includes(error?.message)?error.message:
        error?.name==='TimeoutError'?'ms_warehouse_timeout':'ms_warehouse_unavailable';
      return json(502,{code:raw,upstream,
        upstreamHttp:Number.isInteger(error?.upstreamHttp)&&
          error.upstreamHttp>=300&&error.upstreamHttp<=599?error.upstreamHttp:null,
        readOnly:true,changedRecords:0});
    }
  };
}
export const onRequestGet=createWarehouseAvailabilityHandler();
