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
  if(!['ozon','ozon_fbo','wb'].includes(source)||!safe(account)||!safe(id)||
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
  // v4 takes statuses[] (not the deprecated v3 filter.status).
  // Select new FBS assembly work rather than already shipped postings.
  return {filter:{since:start.toISOString(),to:end.toISOString(),
    statuses:['awaiting_packaging']},
    limit:LIMIT,sort_dir:'DESC',cursor:''};
}
// Dispatch eligibility is intentionally stricter than successful API read.
// These labels describe FBS shipment lifecycle, NOT confirmed demand to sew.
// Only awaiting_packaging can be considered for later inventory-driven planning.
export function classifyMarketplaceOrder(source,status){
  if(source==='ozon_fbo')return {queue:'not_for_sewing',reason:'OZON_FBO_ALREADY_SUPPLIED_TO_MARKETPLACE'};
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
  const raw=source==='wb'?body?.orders:
    source==='ozon_fbo'?(body?.result?.postings||body?.postings):body?.postings;
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
      supplyScheme:source==='ozon_fbo'?'FBO':'FBS',productionQueue:queue.queue,
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
  const headers={Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'};
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
  const headers={Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'};
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

// A read-only, bounded exact article lookup. Marketplace offer_id may not
// equal MoySklad article: only equality from the returned entity counts.
// Two strict filtered queries can establish a positive SKU mapping without
// scanning an entire large assortment. A negative or unavailable filter never
// establishes absence. Both fields must respond successfully to rule out a
// different item sharing the same numeric marketplace SKU.
// Diagnostic evidence reports only validation categories, never customer data
// or raw MoySklad catalog entries. One response per exact source field.
export async function probeExactAssortmentSku(fetcher,token,sku){
  const fields={article:'not_checked',code:'not_checked'};
  if(!safe(sku)||sku.length>100)
    return {match:'unverified',fields};
  const ids=new Map();
  for(const field of ['article','code']){
    const url=new URL('https://api.moysklad.ru/api/remap/1.2/entity/assortment');
    url.searchParams.set('limit','2');
    url.searchParams.set('filter',field+'='+sku);
    let data;
    try{
      data=await requestJson(fetcher,url.toString(),{
        method:'GET',headers:{Authorization:'Bearer '+token,
          Accept:'application/json;charset=utf-8'},
        signal:AbortSignal.timeout(8000)
      });
    }catch(error){
      fields[field]=error?.status===400?'filter_rejected':
        error?.status===403?'permission_denied':
        error?.status===429?'rate_limited':
        error?.message==='source_response_too_large'?'response_too_large':
        'source_unavailable';
      return {match:'unverified',fields};
    }
    if(!Array.isArray(data?.rows)||data.rows.length>2||
      !Number.isSafeInteger(data?.meta?.size)||
      data.meta.size<0||data.meta.size!==data.rows.length){
      fields[field]='schema_unverified';
      return {match:'unverified',fields};
    }
    if(data.meta.size===0){fields[field]='absent_exact';continue;}
    if(data.meta.size===2){fields[field]='ambiguous';return {match:'unverified',fields};}
    for(const item of data.rows){
      if(item?.[field]!==sku||typeof item?.id!=='string'||!item.id){
        fields[field]='schema_unverified';
        return {match:'unverified',fields};
      }
      const matched=ids.get(item.id)||'';
      ids.set(item.id,matched==='article'||field==='article'?'article':'code');
    }
    fields[field]='one_exact';
  }
  if(ids.size!==1)return {match:'unverified',fields};
  return {match:[...ids.values()][0]==='article'?
    'matched_exact_article':'matched_exact_code',fields};
}
export async function verifyExactAssortmentSku(fetcher,token,sku){
  return (await probeExactAssortmentSku(fetcher,token,sku)).match;
}

export async function matchMoyskladArticles(fetcher,token,orders){
  if(!Array.isArray(orders)||orders.length>LIMIT)
    throw Error('invalid_article_lookup');
  const skus=[...new Set(orders.flatMap(o=>o.items.map(p=>p.sku)))];
  const bySku=new Map(skus.map(s=>[s,'unverified']));
  // Scan the collection by pages rather than depending on filter support
  // across MoySklad entity types. Never equate a partial scan with absence.
  const MAX_SKUS=25,PAGE=20,MAX_PAGES=30;
  const selected=skus.filter(s=>safe(s)&&s.length<=100).slice(0,MAX_SKUS);
  const matches=new Map(selected.map(s=>[s,new Map()]));
  const headers={Authorization:'Bearer '+token,
    Accept:'application/json;charset=utf-8'};
  let pages=0,checkedRows=0,complete=false,sourceError=false;
  let failureCode=null;
  let total=null;
  if(!selected.length)return {bySku,requests:0,
    coverage:{pages:0,checkedRows:0,complete:false,sourceError:false,failureCode:null}};
  for(let n=0;n<MAX_PAGES;n++){
    const url=new URL('https://api.moysklad.ru/api/remap/1.2/entity/assortment');
    url.searchParams.set('limit',String(PAGE));
    url.searchParams.set('offset',String(n*PAGE));
    let data;
    try{
      data=await requestJson(fetcher,url.toString(),{
        method:'GET',headers,signal:AbortSignal.timeout(12000)
      });
    }catch(error){
      sourceError=true;
      failureCode=error?.message==='source_response_too_large'?
        'response_too_large':error?.message==='rate_limited'?
        'rate_limited':error?.message==='token_rejected'?
        'token_rejected':error?.message==='permission_denied'?
        'permission_denied':Number.isInteger(error?.status)?
        'upstream_http_error':'response_unavailable';
      break;
    }
    if(!Array.isArray(data?.rows)||data.rows.length>PAGE||
      !Number.isSafeInteger(data?.meta?.size)||data.meta.size<0||
      data.meta.size<data.rows.length){
      sourceError=true;failureCode='schema_unverified';break;
    }
    if(total===null)total=data.meta.size;
    if(total!==data.meta.size){
      sourceError=true;failureCode='size_changed';break;
    }
    for(let i=0;i<data.rows.length;i++){
      const row=data.rows[i];
      if(!row||typeof row!=='object')continue;
      const itemId=typeof row.id==='string'&&row.id.length>0?
        row.id:'page:'+n+':row:'+i;
      for(const sku of selected){
        const byArticle=row.article===sku,byCode=row.code===sku;
        if(byArticle||byCode){
          const existing=matches.get(sku).get(itemId)||'';
          matches.get(sku).set(itemId,byArticle||existing==='article'?
            'article':'code');
        }
      }
    }
    pages++;checkedRows+=data.rows.length;
    if(checkedRows>=total){complete=true;break;}
    if(data.rows.length<PAGE){
      sourceError=true;failureCode='short_page';break;
    }
  }
  // A unique scan match is only established after full coverage.
  for(const sku of selected){
    const entries=[...matches.get(sku).values()];
    if(!complete||sourceError)continue;
    if(entries.length===0)bySku.set(sku,'not_matched');
    else if(entries.length===1)
      bySku.set(sku,entries[0]==='article'?
        'matched_exact_article':'matched_exact_code');
  }
  // When the catalogue is larger than the page budget, try strict positive
  // checks on the first eight SKUs. The two filtered requests must BOTH agree.
  // No filtered zero or failed query ever becomes a 'not_matched' result.
  let exactQueries=0,confirmedByFilter=0;
  const exactDiagnostics=[];
  if(!complete){
    const candidates=selected.filter(s=>bySku.get(s)==='unverified')
      .slice(0,8);
    for(let i=0;i<candidates.length;i+=2){
      await Promise.all(candidates.slice(i,i+2).map(async sku=>{
        const countedFetcher=(url,options)=>{
          exactQueries++;
          return fetcher(url,options);
        };
        const evidence=await probeExactAssortmentSku(countedFetcher,token,sku);
        exactDiagnostics.push({sku,article:evidence.fields.article,
          code:evidence.fields.code,match:evidence.match});
        if(evidence.match==='matched_exact_article'||
          evidence.match==='matched_exact_code'){
          bySku.set(sku,evidence.match);
          confirmedByFilter++;
        }
      }));
    }
  }
  return {bySku,requests:pages+exactQueries,
    coverage:{pages,checkedRows,complete,sourceError,failureCode,
      exactQueries,confirmedByFilter,
      exactDiagnostics:exactDiagnostics.sort((a,b)=>
        selected.indexOf(a.sku)-selected.indexOf(b.sku))}};
}

// Default live preview deliberately uses no bulk assortment scan:
// avoid 30-page reads and stop immediately on 429. Limit to two unique SKUs.
// The existing bulk matcher remains for offline tests and future scheduled
// incremental sync, not for a button-driven production check.
export async function matchMoyskladArticlesBudgeted(fetcher,token,orders,
  skipSkus=new Set()){
  if(!Array.isArray(orders)||orders.length>LIMIT)
    throw Error('invalid_article_lookup');
  const skus=[...new Set(orders.flatMap(o=>o.items.map(p=>p.sku)))];
  const bySku=new Map(skus.map(s=>[s,'unverified']));
  const diagnostics=[];let calls=0,rateLimited=false,confirmed=0;
  for(const sku of skus.filter(x=>safe(x)&&x.length<=100&&
    !skipSkus.has(x)).slice(0,2)){
    const counted=(url,options)=>{calls++;return fetcher(url,options);};
    const evidence=await probeExactAssortmentSku(counted,token,sku);
    diagnostics.push({sku,article:evidence.fields.article,
      code:evidence.fields.code,match:evidence.match});
    if(['matched_exact_article','matched_exact_code'].includes(evidence.match)){
      bySku.set(sku,evidence.match);confirmed++;
    }
    if(evidence.fields.article==='rate_limited'||
      evidence.fields.code==='rate_limited'){
      rateLimited=true;break;
    }
  }
  return {bySku,requests:calls,coverage:{
    pages:0,checkedRows:0,complete:false,sourceError:rateLimited,
    failureCode:rateLimited?'rate_limited':null,
    mode:'TARGETED_ONLY_TO_AVOID_RATE_LIMITS',exactQueries:calls,
    confirmedByFilter:confirmed,exactDiagnostics:diagnostics
  }};
}

// Read Ozon's authoritative seller product identifiers in a single call.
// The result is evidence for reconciliation, NOT a MoySklad product match.
export async function fetchOzonProductEvidence(fetcher,account,token,orders){
  const ids=[...new Set(orders.flatMap(o=>o.items.map(p=>p.sku)))].slice(0,10);
  const evidence=new Map(ids.map(id=>[id,{
    status:'not_confirmed',offerId:id,barcodes:[],productId:null
  }]));
  if(!ids.length)return {byOffer:evidence,code:'empty',count:0};
  try{
    const body=await requestJson(fetcher,
      'https://api-seller.ozon.ru/v3/product/info/list',{
        method:'POST',headers:{'Client-Id':account,'Api-Key':token,
          Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({offer_id:ids}),signal:AbortSignal.timeout(15000)
      });
    const items=body?.items;
    if(!Array.isArray(items)||items.length>10)
      return {byOffer:evidence,code:'schema_unverified',count:0};
    const visited=new Set();
    for(const x of items){
      const id=x?.offer_id;
      if(typeof id!=='string'||!evidence.has(id))continue;
      if(visited.has(id)){
        evidence.set(id,{status:'ambiguous',offerId:id,
          barcodes:[],productId:null});continue;
      }
      visited.add(id);
      const codes=Array.isArray(x.barcodes)?x.barcodes:
        typeof x.barcode==='string'?[x.barcode]:[];
      const safeCodes=[...new Set(codes.filter(v=>
        typeof v==='string'&&/^[0-9A-Za-z-]{6,40}$/.test(v)))].slice(0,4);
      evidence.set(id,{status:safeCodes.length?
        'seller_product_with_barcode':'seller_product_without_barcode',
        offerId:id,barcodes:safeCodes,
        productId:Number.isSafeInteger(x.id)&&x.id>0?x.id:null});
    }
    return {byOffer:evidence,code:'ok',count:visited.size};
  }catch(error){
    const code=error?.message==='rate_limited'?'rate_limited':
      error?.message==='permission_denied'?'permission_denied':
      error?.status===400?'request_rejected':'source_unavailable';
    return {byOffer:evidence,code,count:0};
  }
}

// Try up to two Ozon barcode values against MoySklad. A 200 with an exact
// entity barcode plus one unique document is positive evidence. Filter failures
// and empty responses NEVER prove absence or authorize creating an entity.
export function barcodeValues(row){
  const allowed=['ean13','ean8','code128','upc','gtin','code39'];
  if(!Array.isArray(row?.barcodes))return [];
  return [...new Set(row.barcodes.flatMap(item=>{
    if(typeof item==='string')return [item];
    if(!item||typeof item!=='object')return [];
    return allowed.map(field=>item[field]).filter(v=>typeof v==='string');
  }).filter(v=>/^[0-9A-Za-z-]{6,40}$/.test(v)))];
}
export async function matchMoyskladOzonBarcodes(fetcher,token,orders){
  const bySku=new Map(),diagnostics=[];
  const selected=new Map();
  for(const order of orders){
    for(const item of order.items){
      const sku=item.sku;
      if(bySku.has(sku))continue;
      bySku.set(sku,'unverified');
      const codes=item.ozonCatalog?.status==='seller_product_with_barcode'?
        item.ozonCatalog.barcodes:[];
      if(!Array.isArray(codes)||!codes.length)continue;
      selected.set(sku,codes[0]);
    }
  }
  let requests=0,rateLimited=false;
  for(const [sku,code] of [...selected].slice(0,2)){
    if(rateLimited)break;
    const url=new URL('https://api.moysklad.ru/api/remap/1.2/entity/assortment');
    url.searchParams.set('limit','2');
    url.searchParams.set('filter','barcode='+code);
    let category='unverified';
    try{
      requests++;
      const body=await requestJson(fetcher,url.toString(),{
        method:'GET',headers:{Authorization:'Bearer '+token,
          Accept:'application/json;charset=utf-8'},
        signal:AbortSignal.timeout(8000)
      });
      if(Array.isArray(body?.rows)&&body.rows.length<=2&&
        Number.isSafeInteger(body?.meta?.size)&&
        body.meta.size===1&&body.rows.length===1&&
        typeof body.rows[0]?.id==='string'&&body.rows[0].id&&
        barcodeValues(body.rows[0]).includes(code)){
        bySku.set(sku,'matched_exact_barcode');
        category='one_exact';
      }else if(body?.meta?.size===0&&Array.isArray(body?.rows)&&
        body.rows.length===0)category='absent_exact';
      else category='unverified';
    }catch(error){
      if(error?.status===429){rateLimited=true;category='rate_limited';}
      else if(error?.status===400)category='filter_rejected';
      else if(error?.status===403)category='permission_denied';
      else category='source_unavailable';
    }
    diagnostics.push({sku,category});
  }
  return {bySku,requests,diagnostics,rateLimited};
}

export function createMarketplaceOrderPreview({fetcher=fetch,now=Date.now}={}){
  return async({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let url;try{url=new URL(request.url);}catch{return json(400,{code:'invalid_scope'});}
    const keys=[...url.searchParams.keys()];
    const source=url.searchParams.get('source');
    if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||
      keys.length!==1||keys[0]!=='source'||!['ozon','ozon_fbo','wb'].includes(source))
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
      }else if(source==='ozon_fbo'){
        upstream='https://api-seller.ozon.ru/v3/posting/fbo/list';
        const end=new Date(now()),start=new Date(end.getTime()-7*86400000);
        options={method:'POST',headers:{'Client-Id':account,
          'Api-Key':token,Accept:'application/json','Content-Type':'application/json'},
          body:JSON.stringify({filter:{since:start.toISOString(),to:end.toISOString()},
            limit:LIMIT,offset:0,dir:'DESC'})};
      }else{
        upstream='https://api-seller.ozon.ru/v4/posting/fbs/list';
        options={method:'POST',headers:{'Client-Id':account,
          'Api-Key':token,Accept:'application/json','Content-Type':'application/json'},
          body:JSON.stringify(buildOzonFbsPreviewBody(now()))};
      }
      const body=await requestJson(fetcher,upstream,options);
      const orders=normalizeMarketplaceOrders(source,body,account);
      if(source==='ozon'&&orders.some(x=>x.status!=='awaiting_packaging'))
        throw Error('ozon_status_filter_unverified');
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
      // Independent seller catalogue evidence, one Ozon request per preview.
      // Barcode presence alone never authorizes MoySklad matching/writes.
      const ozonEvidence=source==='wb'?null:
        await fetchOzonProductEvidence(fetcher,account,token,orders);
      if(ozonEvidence){
        for(const order of orders)for(const item of order.items){
          item.ozonCatalog=ozonEvidence.byOffer.get(item.sku)||{
            status:'not_confirmed',offerId:item.sku,
            barcodes:[],productId:null
          };
        }
      }
      // Article comparison is informative only. It can never authorize a
      // write or production dispatch, even for an exact single match.
      let articleScan={bySku:new Map(),requests:0,
        coverage:{pages:0,checkedRows:0,complete:false,sourceError:false,failureCode:null}};
      const barcodeCandidates=new Set(orders.flatMap(o=>o.items)
        .filter(p=>p.ozonCatalog?.status==='seller_product_with_barcode')
        .map(p=>p.sku));
      const barcodeScan=barcodeCandidates.size?
        await matchMoyskladOzonBarcodes(fetcher,env.MS_API_TOKEN,orders):
        {bySku:new Map(),requests:0,diagnostics:[],rateLimited:false};
      if(orders.length&&!barcodeScan.rateLimited)
        articleScan=await matchMoyskladArticlesBudgeted(
          fetcher,env.MS_API_TOKEN,orders,barcodeCandidates);
      for(const order of orders){
        for(const item of order.items){
          item.assortmentMatch=
            barcodeScan.bySku.get(item.sku)==='matched_exact_barcode'?
              'matched_exact_barcode':
              articleScan.bySku.get(item.sku)||'unverified';
          if(ozonEvidence)item.ozonCatalog=
            ozonEvidence.byOffer.get(item.sku)||{
              status:'not_confirmed',offerId:item.sku,
              barcodes:[],productId:null};
        }
        const matches=scan?.matches?.get(order.externalKey)||0;
        order.duplicateStatus=matches===1?'already_exists':
          matches>1?'unverified':
          scan?.complete===true&&!lookupFailure?'not_found':'unverified';
        order.duplicateLookup='bounded_list_scan';
      }
      return json(200,{code:'marketplace_order_import_preview_ok',
        source,readOnly:true,changedRecords:0,approvedForWrite:false,
        coverage:source==='ozon_fbo'?'FBO_FIRST_PAGE_LAST_7_DAYS_NOT_PRODUCTION_QUEUE':
          source==='ozon'?
          'FBS_AWAITING_PACKAGING_FIRST_PAGE_LAST_7_DAYS':
          'FBS_NEW_FIRST_PAGE_ONLY_NOT_ALL_MARKETPLACE_ORDERS',
        sampledAt:new Date(now()).toISOString(),
        duplicateLookupMode:scan?.complete?
          'COMPLETE_BOUNDED_LIST_SCAN':'PARTIAL_BOUNDED_LIST_SCAN',
        duplicateScan:{checkedRows:scan?.checkedRows||0,
          pages:scan?.pages||0,complete:scan?.complete===true},
        duplicateLookupFailure:lookupFailure,
        ozonProductLookup:ozonEvidence?{
          status:ozonEvidence.code,
          productsConfirmed:ozonEvidence.count,
          requestCount:orders.length?1:0}:null,
        barcodeLookup:{requests:barcodeScan.requests,
          diagnostics:barcodeScan.diagnostics,
          rateLimited:barcodeScan.rateLimited},
        articleLookupRequests:articleScan.requests,
        assortmentCoverage:articleScan.coverage,
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
        'source_error','ozon_status_filter_unverified'].includes(error?.message)?
          error.message:'import_preview_unavailable');
      return json(503,{code,source,stage:failedStage,
        upstreamHttp:Number.isInteger(error?.status)?error.status:null,
        readOnly:true,changedRecords:0,approvedForWrite:false});
    }
  };
}
export const onRequestGet=createMarketplaceOrderPreview();
