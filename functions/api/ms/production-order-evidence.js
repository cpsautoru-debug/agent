import {verifySession} from '../auth/session.js';

// Owner-only read of links between one production task and customer orders.
// This exposes NO buyer details and NEVER guesses which custom status means
// "open", "cancelled", "shipped", or "complete".
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-order-evidence';
const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER=/^\d{1,10}$/;
const MAX_LINKS=3;
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const limited=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&
  !/[\u0000-\u001f\u007f]/.test(v)?v:null;
const safeCode=(status)=>status===429?'ms_rate_limited':
  status===403?'ms_permission_denied':status===401?'ms_token_rejected':
  'ms_order_source_unavailable';
export function parseTaskOrderLinks(value){
  if(!Array.isArray(value)||value.length>MAX_LINKS)
    return {status:'unverified',reason:'links_missing_or_unbounded',ids:[]};
  const ids=[];
  for(const ref of value){
    const href=ref?.meta?.href;
    const match=typeof href==='string'&&
      /^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/customerorder\/([0-9a-f-]{36})$/i.exec(href);
    if(!match||!UUID.test(match[1])||ids.includes(match[1].toLowerCase()))
      return {status:'unverified',reason:'invalid_customer_order_reference',ids:[]};
    ids.push(match[1].toLowerCase());
  }
  return {status:ids.length?'linked':'none',reason:null,ids};
}
export function summarizeLinkedOrder(order,id){
  if(!order||order.id?.toLowerCase()!==id.toLowerCase()||
    !UUID.test(order.id)||typeof order.applicable!=='boolean')
    return {verification:'unverified',posted:null,stateName:null,updated:null};
  const state=limited(order.state?.name,100);
  const updated=limited(order.updated,40);
  return {verification:state?'state_read':'state_missing',
    posted:order.applicable,stateName:state,updated};
}
async function fetchJson(fetcher,url,token){
  const res=await fetcher(url,{method:'GET',redirect:'manual',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    signal:AbortSignal.timeout(20000)});
  if(res.status!==200){await res.body?.cancel().catch(()=>{});
    const err=Error(safeCode(res.status));err.code=safeCode(res.status);throw err;}
  const reader=res.body?.getReader();if(!reader)throw Error('ms_order_body_unavailable');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,body='';
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done){body+=decoder.decode();break;}
      bytes+=value.byteLength;
      if(bytes>128*1024)throw Error('ms_order_response_too_large');
      body+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(body);
}
export function createProductionOrderEvidenceHandler({fetcher=fetch,pause=
  ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  return async ({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let url;try{url=new URL(request.url);}catch{return json(400,{code:'invalid_order_evidence_scope'});}
    if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||
      [...url.searchParams.keys()].length!==1||
      !url.searchParams.has('number')||
      !NUMBER.test(url.searchParams.get('number')||''))
      return json(400,{code:'invalid_order_evidence_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return json(401,{code:'owner_session_required'});}
    if(!sub)return json(401,{code:'owner_session_required'});
    try{
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    }catch{return json(503,{code:'owner_auth_unavailable'});}
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
      /\s/.test(env.MS_API_TOKEN))
      return json(503,{code:'ms_token_unavailable'});
    const number=url.searchParams.get('number');
    let requests=0;
    try{
      const feed=new URL(ROOT+'productiontask');
      feed.searchParams.set('limit','2');
      feed.searchParams.set('filter','name='+number);
      const payload=await fetchJson(fetcher,feed.toString(),env.MS_API_TOKEN);
      requests++;
      if(!Array.isArray(payload?.rows)||payload.rows.length!==1||
        payload.meta?.size!==1||payload.rows[0]?.name!==number||
        !UUID.test(payload.rows[0]?.id||''))
        return json(422,{code:'production_task_identity_unverified',
          readOnly:true,changedRecords:0});
      const task=payload.rows[0];
      const links=parseTaskOrderLinks(task.customerOrders);
      if(links.status==='unverified')
        return json(200,{code:'ms_order_evidence_unverified',readOnly:true,
          changedRecords:0,number,taskId:task.id.toLowerCase(),
          linkage:'unverified',reason:links.reason,
          orderStatusVerified:false,approvedForDispatch:false,requests});
      const orders=[];
      for(const id of links.ids){
        await pause(2000);
        const orderUrl=new URL(ROOT+'customerorder/'+id);
        orderUrl.searchParams.set('expand','state');
        const raw=await fetchJson(fetcher,orderUrl.toString(),env.MS_API_TOKEN);
        requests++;
        orders.push(summarizeLinkedOrder(raw,id));
      }
      return json(200,{code:'ms_order_evidence_ok',readOnly:true,
        changedRecords:0,number,taskId:task.id.toLowerCase(),
        linkage:links.status,linkedOrderCount:links.ids.length,
        orders,orderStatusVerified:orders.length>0&&
          orders.every(x=>x.verification==='state_read'),
        approvedForDispatch:false,requests,
        meaning:'CUSTOM_STATUS_LABELS_NOT_MAPPED_TO_LIVE_QUEUE'});
    }catch(error){
      const code=/^(ms_rate_limited|ms_token_rejected|ms_permission_denied)$/.test(error?.code||'')?
        error.code:'ms_order_evidence_unavailable';
      return json(503,{code,readOnly:true,changedRecords:0,
        approvedForDispatch:false,requests});
    }
  };
}
export const onRequestGet=createProductionOrderEvidenceHandler();
