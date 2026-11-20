import {verifySession} from '../auth/session.js';
import {buildCurrentWarehouseUrl,findStore,parseCurrentStock} from './warehouse-availability.js';
import {buildNamesUrl,extractNames} from './stock-bystore.js';

// One manual request = one bounded stock snapshot for ONE selected store.
// Maximum 40 nonzero positions, never an unlimited crawl.
const HOST='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/warehouse-snapshot';
const STORE='https://api.moysklad.ru/api/remap/1.2/entity/store';
const MAX_ROWS=40;
const GAP_MS=2000;
const NAME=/^[\p{L}\p{N} .,_\-–—()]{3,120}$/u;
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
};
const json=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const waitFor=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function parseSnapshotScope(url){
  if(url.origin!==HOST||url.pathname!==PATH||url.hash||
    [...url.searchParams.keys()].length!==1||
    !url.searchParams.has('store'))
    throw Error('invalid_snapshot_scope');
  const store=url.searchParams.get('store');
  if(!store||!NAME.test(store)||store!==store.trim()||/\s{2}/.test(store))
    throw Error('invalid_snapshot_scope');
  return {store};
}
async function boundedJson(response,limit){
  const reader=response.body?.getReader();
  if(!reader)throw Error('snapshot_unverified');
  let bytes=0,raw='';
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const chunk=await reader.read();
      if(chunk.done){raw+=decoder.decode();break;}
      bytes+=chunk.value.byteLength;
      if(bytes>limit)throw Error('snapshot_unverified');
      raw+=decoder.decode(chunk.value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(raw);}catch{throw Error('snapshot_unverified');}
}
export function summarizeWarehouseSnapshot(lines,names,warehouse,requests){
  if(!Array.isArray(lines)||lines.length>MAX_ROWS||
    !(names instanceof Map)||names.size!==lines.length||
    !Number.isSafeInteger(requests)||requests<2||requests>6)
    throw Error('snapshot_unverified');
  const items=lines.map(line=>{
    const item=names.get(line.id);
    if(!item||typeof item.name!=='string'||!item.name)
      throw Error('snapshot_unverified');
    return {
      name:item.name,
      code:item.code||null,
      uom:item.uom||null,
      catalogPath:item.catalogPath||null,
      stock:line.stock
    };
  });
  return {
    code:'ms_warehouse_snapshot_ok',
    scope:'ONE_STORE_NONZERO_SNAPSHOT_MAX_40',
    source:'MOYSKLAD_BYSTORE_CURRENT_NONZERO',
    readOnly:true,changedRecords:0,
    warehouseName:warehouse.name,
    warehouseLines:lines.length,
    completeForCurrentReport:true,
    limit:MAX_ROWS,
    itemCount:items.length,
    namesResolved:items.length,
    positiveRows:lines.filter(x=>typeof x.stock==='number'&&x.stock>0).length,
    negativeRows:lines.filter(x=>typeof x.stock==='number'&&x.stock<0).length,
    unknownRows:lines.filter(x=>x.stock===null).length,
    requests,
    items
  };
}
export function createWarehouseSnapshotHandler(fetcher=fetch,wait=waitFor){
  return async({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let scope;
    try{scope=parseSnapshotScope(new URL(request.url));}
    catch{return json(400,{code:'invalid_snapshot_scope'});}
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    let sub;
    try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return json(401,{code:'owner_session_required'});}
    if(!sub)return json(401,{code:'owner_session_required'});
    try{
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    }catch{return json(503,{code:'owner_auth_unavailable'});}
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
      /\s/.test(env.MS_API_TOKEN))return json(503,{code:'ms_token_unavailable'});
    let stage='stores',requests=0;
    try{
      const get=async(url,cap)=>{
        if(requests>=6)throw Error('snapshot_unverified');
        // All upstream reads sequential. No retries, fanout or background tasks.
        if(requests>0)await wait(GAP_MS);
        requests++;
        const response=await fetcher(url,{
          method:'GET',redirect:'manual',
          headers:{
            Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json;charset=utf-8'
          },
          signal:AbortSignal.timeout(20000)
        });
        if(response.status!==200){
          await response.body?.cancel().catch(()=>{});
          const error=Error(response.status===429?'ms_rate_limited':
            response.status===401?'ms_token_rejected':
            response.status===403?'ms_warehouse_permission_denied':
            'ms_warehouse_upstream_error');
          error.upstreamHttp=response.status;
          throw error;
        }
        return boundedJson(response,cap);
      };
      const storeUrl=new URL(STORE);
      storeUrl.searchParams.set('limit','50');
      storeUrl.searchParams.set('offset','0');
      const warehouse=findStore(await get(storeUrl.toString(),64*1024),scope.store);
      stage='current';
      // The *single* current report supplies all quantities in one read.
      const lines=parseCurrentStock(await get(buildCurrentWarehouseUrl(warehouse.id),256*1024),
        warehouse.id);
      if(lines.length>MAX_ROWS)
        return json(409,{
          code:'warehouse_snapshot_over_limit',limit:MAX_ROWS,
          readOnly:true,changedRecords:0
        });
      let names=new Map();
      stage='assortment';
      for(let i=0;i<lines.length;i+=10){
        const ids=lines.slice(i,i+10).map(x=>x.id);
        const url=new URL(buildNamesUrl(ids));
        url.searchParams.set('expand','uom');
        const result=extractNames(await get(url.toString(),128*1024),ids);
        // Every product must be named; never present a partial "complete" snapshot.
        if(result.size!==ids.length)throw Error('snapshot_unverified');
        for(const [id,info] of result){
          if(!info.name||names.has(id))throw Error('snapshot_unverified');
          names.set(id,info);
        }
      }
      return json(200,summarizeWarehouseSnapshot(lines,names,warehouse,requests));
    }catch(error){
      const allowed=['ms_rate_limited','ms_token_rejected',
        'ms_warehouse_permission_denied','ms_warehouse_upstream_error',
        'warehouse_unverified','warehouse_not_found_or_ambiguous',
        'stock_unverified','snapshot_unverified'];
      const code=allowed.includes(error?.message)?
        error.message==='snapshot_unverified'||error.message==='stock_unverified'||
        error.message==='warehouse_unverified'?'ms_snapshot_unverified':error.message:
        error?.name==='TimeoutError'?'ms_snapshot_timeout':'ms_snapshot_unavailable';
      return json(502,{
        code,stage,
        upstreamHttp:Number.isInteger(error?.upstreamHttp)&&
          error.upstreamHttp>=300&&error.upstreamHttp<=599?error.upstreamHttp:null,
        readOnly:true,changedRecords:0
      });
    }
  };
}
export const onRequestGet=createWarehouseSnapshotHandler();
