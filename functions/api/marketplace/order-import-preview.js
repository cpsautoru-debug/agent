import {verifySession} from '../auth/session.js';

// Zero-write reconciliation preview: FBS marketplace orders vs MoySklad.
// No creation, inventory movement, cancellation or personal data returned.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/marketplace/order-import-preview';
const MS='https://api.moysklad.ru/api/remap/1.2/entity/customerorder';
const LIMIT=10,MAX_BYTES=256*1024;
const HEADER={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADER});
const safe=s=>typeof s==='string'&&s.length>0&&s.length<=100&&
  !/[\u0000-\u001f\u007f]/.test(s);
const sourceError=(status)=>status===401?'token_rejected':
  status===403?'permission_denied':status===429?'rate_limited':
  'source_error';

export function externalKey(source,account,id){
  if(!['ozon','wb'].includes(source)||!safe(account)||!safe(id)||
    !/^[a-zA-Z0-9._:-]{1,100}$/.test(account)||
    !/^[a-zA-Z0-9._:-]{1,100}$/.test(id))
    throw Error('invalid_external_order_identity');
  const key='AS63:'+source+':'+account+':'+id;
  if(key.length>180)throw Error('external_order_key_too_long');
  return key;
}
export function buildOzonFbsPreviewBody(nowMs){
  if(!Number.isFinite(nowMs)||nowMs<0)throw Error('invalid_preview_clock');
  const end=new Date(nowMs),start=new Date(nowMs-7*86400000);
  return {filter:{since:start.toISOString(),to:end.toISOString()},
    limit:LIMIT,sort_dir:'DESC',cursor:''};
}
// Dispatch eligibility is intentionally stricter than successful API read.
// These labels describe FBS shipment lifecycle, NOT confirmed demand to sew.
// Only awaiting_packaging can be considered for later inventory-driven planning.
export function classifyMarketplaceOrder(source,status){
  if(source==='wb'&&status==='new_fbs_assembly_order')
    return {queue:'candidate_needs_inventory',reason:'WB_NEW_FBS_REQUIRES_STOCK_CHECK'};
  if(source!=='ozon')return {queue:'not_for_sewing',reason:'UNKNOWN_SOURCE'};
  if(status==='awaiting_packaging')
    return {queue:'candidate_needs_inventory',reason:'OZON_AWAITING_PACKAGING'};
  if(['cancelled','cancelled_from_split_pending','delivered',
    'delivering','awaiting_deliver','driver_pickup','not_accepted',
    'acceptance_in_progress'].includes(status))
    return {queue:'not_for_sewing',reason:'OZON_FULFILLMENT_OR_TERMINAL'};
  return {queue:'unverified',reason:'OZON_STATUS_UNVERIFIED'};
}

export function normalizeMarketplaceOrders(source,body,account){
  const raw=source==='wb'?body?.orders:body?.postings;
  if(!Array.isArray(raw)||raw.length>100)throw Error('unexpected_order_feed');
  const ids=new Set();
  const records=raw.slice(0,LIMIT).map(x=>{
    const id=source==='wb'?String(x?.id??''):x?.posting_number;
    const code=externalKey(source,account,id);
    if(ids.has(code))throw Error('duplicate_source_order');ids.add(code);
    const rows=source==='wb'?[x]:x?.products;
    if(!Array.isArray(rows)||rows.length===0||rows.length>50)
      throw Error('unexpected_order_lines');
    const items=rows.map(p=>{
      const sku=source==='wb'?(p.article||p.supplierArticle):p.offer_id;
      const count=source==='wb'?1:p.quantity;
      if(!safe(sku)||!Number.isSafeInteger(count)||count<1||count>1000)
        throw Error('unmapped_order_line');
      return {sku,quantity:count,assortmentVerified:false};
    });
    const status=source==='wb'?'new_fbs_assembly_order':
      safe(x.status)?x.status:'unknown';
    const queue=classifyMarketplaceOrder(source,status);
    return {externalKey:code,source,status,items,
      supplyScheme:'FBS',productionQueue:queue.queue,
      productionQueueReason:queue.reason,
      assortmentVerified:false,legalEntityVerified:false,readyToWrite:false};
  });
  return records;
}
async function readJson(response){
  const r=response.body?.getReader();if(!r)throw Error('missing_body');
  let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  try{while(true){const {value,done}=await r.read();
    if(done){text+=decoder.decode();break;}
    size+=value.byteLength;if(size>MAX_BYTES)throw Error('source_response_too_large');
    text+=decoder.decode(value,{stream:true});}
  }finally{await r.cancel().catch(()=>{});}
  return JSON.parse(text);
}
async function requestJson(fetcher,url,options){
  const response=await fetcher(url,{redirect:'manual',
    signal:AbortSignal.timeout(20000),...options});
  if(response.status!==200){
    // Read a bounded structured error only for an upstream numeric code.
    // Never return human-readable upstream messages or user/order details.
    let upstreamCode=null;
    try{
      const body=await readJson(response);
      const first=body?.errors?.[0]?.code;
      if(Number.isSafeInteger(first)&&first>=0&&first<=999999)
        upstreamCode=first;
    }catch{await response.body?.cancel().catch(()=>{});}
    const e=Error(sourceError(response.status));
    e.status=response.status;e.upstreamCode=upstreamCode;throw e;
  }
  return readJson(response);
}
// Some MoySklad installations reject externalCode as a filter (HTTP 400).
// A full-text search can establish a duplicate only when an exact externalCode
// is returned. An empty search NEVER proves that an order does not exist.
export async function lookupMoyskladDuplicate(fetcher,token,key){
  const headers={Authorization:'Bearer '+token,Accept:'application/json'};
  const query=new URL(MS);
  query.searchParams.set('limit','2');
  query.searchParams.set('filter','externalCode='+key);
  let result,method='exact_filter',queries=0;
  try{
    result=await requestJson(fetcher,query.toString(),{method:'GET',headers});
    queries++;
  }catch(error){
    if(error?.status!==400)throw error;
    // Reserve one query for an API-supported contextual lookup.
    const search=new URL(MS);
    search.searchParams.set('limit','2');
    search.searchParams.set('search',key);
    result=await requestJson(fetcher,search.toString(),{method:'GET',headers});
    queries+=2;method='context_search';
  }
  if(!Array.isArray(result?.rows)||!Number.isSafeInteger(result?.meta?.size)||
    result.meta.size<result.rows.length||result.rows.length>2)
    throw Error('moysklad_lookup_unverified');
  const matches=result.rows.filter(x=>x?.externalCode===key);
  return {status:matches.length===1&&result.meta.size===1?'already_exists':
    method==='exact_filter'&&result.meta.size===0?'not_found':'unverified',
    method,queries};
}

// Read-only bounded page scan. Unlike unsupported externalCode filters,
// GET customerorder?limit&offset is documented for all account types.
// Positive duplicate identification is by exact externalCode equality ONLY.
// A partial or changing scan cannot prove a key is absent.
export async function scanMoyskladOrderKeys(fetcher,token,keys){
  if(!Array.isArray(keys)||keys.length>LIMIT||
    keys.some(k=>typeof k!=='string'||k.length>180))
    throw Error('invalid_duplicate_scan_keys');
  const PAGE=25,MAX_PAGES=8;
  const counts=new Map(keys.map(k=>[k,0]));
  let pages=0,seen=0,complete=false,declaredSize=null;
  const headers={Authorization:'Bearer '+token,Accept:'application/json'};
  for(let page=0;page<MAX_PAGES;page++){
    const url=new URL(MS);
    url.searchParams.set('limit',String(PAGE));
    url.searchParams.set('offset',String(page*PAGE));
    let result;
    try{result=await requestJson(fetcher,url.toString(),{method:'GET',headers});}
    catch(error){
      if(pages===0)throw error;
      return {matches:counts,checkedRows:seen,pages,
        complete:false,sourceError:true};
    }
    if(!Array.isArray(result?.rows)||result.rows.length>PAGE||
       !Number.isSafeInteger(result?.meta?.size)||result.meta.size<0)
      throw Error('moysklad_lookup_unverified');
    if(declaredSize===null)declaredSize=result.meta.size;
    if(result.meta.size!==declaredSize)
      return {matches:counts,checkedRows:seen,pages,
        complete:false,sourceError:true};
    for(const row of result.rows){
      if(typeof row?.externalCode==='string'&&counts.has(row.externalCode))
        counts.set(row.externalCode,counts.get(row.externalCode)+1);
    }
    seen+=result.rows.length;pages++;
    if(seen>=declaredSize){complete=true;break;}
    if(result.rows.length<PAGE)break;
    // A positive match on all queried keys is enough to stop looking.
    if(keys.length>0&&keys.every(k=>counts.get(k)>0))break;
  }
  return {matches:counts,checkedRows:seen,pages,complete,
    sourceError:false};
}

export function createMarketplaceOrderPreview({fetcher=fetch,now=Date.now}={}){
  return async({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let url;try{url=new URL(request.url);}catch{return json(400,{code:'invalid_scope'});}
    const keys=[...url.searchParams.keys()];
    const source=url.searchParams.get('source');
    if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||
      keys.length!==1||keys[0]!=='source'||!['ozon','wb'].includes(source))
      return json(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB)return json(503,{code:'owner_auth_unavailable'});
    let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return json(401,{code:'owner_session_required'});}
    if(!sub)return json(401,{code:'owner_session_required'});
    try{const owner=await env.OZON_FINANCE_DB.prepare(
      "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
    ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
    if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    }catch{return json(503,{code:'owner_auth_unavailable'});}
    const token=source==='wb'?env.WB_API_TOKEN:env.OZON_API_KEY;
    const account=source==='wb'?'wb-primary':String(env.OZON_CLIENT_ID||'');
    if(typeof token!=='string'||!token||/\s/.test(token)||
      !safe(account))return json(503,{code:'marketplace_credentials_missing'});
    let failedStage='marketplace';
    try{
      let upstream,options;
      if(source==='wb'){
        upstream='https://marketplace-api.wildberries.ru/api/v3/orders/new';
        options={method:'GET',headers:{Authorization:token,Accept:'application/json'}};
      }else{
        upstream='https://api-seller.ozon.ru/v4/posting/fbs/list';
        options={method:'POST',headers:{'Client-Id':account,
          'Api-Key':token,Accept:'application/json','Content-Type':'application/json'},
          body:JSON.stringify(buildOzonFbsPreviewBody(now()))};
      }
      const body=await requestJson(fetcher,upstream,options);
      const orders=normalizeMarketplaceOrders(source,body,account);
      if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
        /\s/.test(env.MS_API_TOKEN))
        return json(503,{code:'moysklad_credentials_missing'});
      let msQueries=0,scan=null,lookupFailure=null;
      failedStage='moysklad';
      try{
        scan=orders.length?
          await scanMoyskladOrderKeys(fetcher,env.MS_API_TOKEN,
            orders.map(o=>o.externalKey)):
          {matches:new Map(),pages:0,checkedRows:0,complete:false,
            sourceError:false};
        msQueries=scan.pages;
        if(scan.sourceError)
          lookupFailure={code:'moysklad_partial_scan',http:null};
      }catch(error){
        lookupFailure={code:Number.isInteger(error?.status)&&error.status===400?
          'moysklad_list_rejected':
          Number.isInteger(error?.status)&&error.status===403?
            'moysklad_permission_denied':'moysklad_list_unavailable',
          http:Number.isInteger(error?.status)?error.status:null,
          upstreamCode:Number.isSafeInteger(error?.upstreamCode)?
            error.upstreamCode:null};
      }
      for(const order of orders){
        const matches=scan?.matches?.get(order.externalKey)||0;
        order.duplicateStatus=matches===1?'already_exists':
          matches>1?'unverified':
          scan?.complete===true&&!lookupFailure?'not_found':'unverified';
        order.duplicateLookup='bounded_list_scan';
      }
      return json(200,{code:'marketplace_order_import_preview_ok',
        source,readOnly:true,changedRecords:0,approvedForWrite:false,
        coverage:'FBS_FIRST_PAGE_ONLY_NOT_ALL_MARKETPLACE_ORDERS',
        sampledAt:new Date(now()).toISOString(),
        duplicateLookupMode:scan?.complete?
          'COMPLETE_BOUNDED_LIST_SCAN':'PARTIAL_BOUNDED_LIST_SCAN',
        duplicateScan:{checkedRows:scan?.checkedRows||0,
          pages:scan?.pages||0,complete:scan?.complete===true},
        duplicateLookupFailure:lookupFailure,
        counts:{received:orders.length,
          candidateNeedsInventory:orders.filter(x=>
            x.productionQueue==='candidate_needs_inventory').length,
          notForSewing:orders.filter(x=>x.productionQueue==='not_for_sewing').length,
          statusUnverified:orders.filter(x=>x.productionQueue==='unverified').length,
          msLookups:msQueries,
          existing:orders.filter(x=>x.duplicateStatus==='already_exists').length,
          notFound:orders.filter(x=>x.duplicateStatus==='not_found').length,
          uncertain:orders.filter(x=>x.duplicateStatus==='unverified').length},
        orders});
    }catch(error){
      // Return only bounded error categories; never include raw marketplace
      // response bodies, tokens, addresses, customer identifiers or URLs.
      const parserIssue=error instanceof SyntaxError?'upstream_invalid_json':
        error?.message==='source_response_too_large'?'upstream_response_too_large':
        error?.message==='missing_body'?'upstream_body_missing':null;
      const code=parserIssue||(
        ['token_rejected','permission_denied','rate_limited',
        'unexpected_order_feed','unexpected_order_lines','unmapped_order_line',
        'duplicate_source_order','invalid_external_order_identity',
        'moysklad_lookup_unverified','external_order_key_too_long',
        'source_error'].includes(error?.message)?
          error.message:'import_preview_unavailable');
      return json(503,{code,source,stage:failedStage,
        upstreamHttp:Number.isInteger(error?.status)?error.status:null,
        readOnly:true,changedRecords:0,approvedForWrite:false});
    }
  };
}
export const onRequestGet=createMarketplaceOrderPreview();
