import {verifySession} from '../auth/session.js';

// Read-only metadata: names/identifiers of order states, no customer orders,
// buyers, sales, personal data, or automatic active/closed assumptions.
const BASE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/customer-order-status-catalog';
const URL='https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const clean=s=>typeof s==='string'&&s.length>0&&s.length<=100&&
  !/[\u0000-\u001f\u007f]/.test(s);
export function normalizeOrderStates(metadata){
  if(!Array.isArray(metadata?.states)||metadata.states.length>100)
    throw Error('ms_order_states_missing');
  const ids=new Set(),names=new Set();
  const states=metadata.states.map(row=>{
    if(!UUID.test(row?.id||'')||!clean(row.name)||ids.has(row.id.toLowerCase())||
      names.has(row.name.toLocaleLowerCase('ru-RU')))
      throw Error('ms_order_state_invalid');
    const id=row.id.toLowerCase();ids.add(id);
    names.add(row.name.toLocaleLowerCase('ru-RU'));
    const type=row.stateType;
    // Missing/unknown type remains unverified; never infer terminal status.
    const verifiedType=['Regular','Successful','Unsuccessful'].includes(type);
    return {id,name:row.name,
      stateType:verifiedType?type:null,
      terminal:verifiedType?
        (type==='Successful'||type==='Unsuccessful'):null};
  });
  return {states,count:states.length,interpretation:'UNMAPPED_SOURCE_STATES_NOT_ACTIVE_ORDER_CLASSIFICATION'};
}
async function boundedJson(res){
  const reader=res.body?.getReader();if(!reader)throw Error('no_response_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done){text+=decoder.decode();break;}
      bytes+=value.byteLength;if(bytes>128*1024)throw Error('body_too_large');
      text+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(text);
}
export function createOrderStatusCatalogHandler({fetcher=fetch}={}){
  return async({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let u;try{u=new URL(request.url);}catch{return json(400,{code:'invalid_scope'});}
    if(u.origin!==BASE||u.pathname!==PATH||u.search||u.hash)
      return json(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
    catch{return json(401,{code:'owner_session_required'});}
    if(!sub)return json(401,{code:'owner_session_required'});
    try{
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    }catch{return json(503,{code:'owner_auth_unavailable'});}
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
      /\s/.test(env.MS_API_TOKEN))
      return json(503,{code:'ms_token_unavailable'});
    try{
      const response=await fetcher(URL,{method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
          Accept:'application/json;charset=utf-8'},
        signal:AbortSignal.timeout(20000)});
      if(response.status!==200){
        await response.body?.cancel().catch(()=>{});
        return json(response.status===429?429:502,{
          code:response.status===429?'ms_rate_limited':
            response.status===401?'ms_token_rejected':
            response.status===403?'ms_permission_denied':'ms_upstream_error',
          readOnly:true});
      }
      return json(200,{code:'ms_order_status_catalog_ok',
        ...normalizeOrderStates(await boundedJson(response)),
        readOnly:true,changedRecords:0,approvedForDispatch:false,
        source:'MOYSKLAD_CUSTOMER_ORDER_METADATA',
        sampledAt:new Date().toISOString()});
    }catch{return json(503,{code:'ms_order_status_catalog_unavailable',readOnly:true});}
  };
}
export const onRequestGet=createOrderStatusCatalogHandler();
