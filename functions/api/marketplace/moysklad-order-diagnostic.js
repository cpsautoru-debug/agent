import {verifySession} from '../auth/session.js';

// Narrow owner-only diagnostic: check endpoint availability and HTTP response
// without returning any customer document, PII, token, or upstream message.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/marketplace/moysklad-order-diagnostic';
const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/';
const H={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(status,v)=>new Response(JSON.stringify(v),{status,headers:H});
const PROBES=[
  {id:'customerorder_default',url:ROOT+'customerorder?limit=1'},
  {id:'customerorder_offset_zero',url:ROOT+'customerorder?limit=1&offset=0'},
  {id:'productiontask_control',url:ROOT+'productiontask?limit=1'}
];
function safeCode(payload){
  const e=Array.isArray(payload?.errors)?payload.errors[0]:null;
  const code=e?.code;
  return Number.isSafeInteger(code)&&code>=0&&code<=9999999?code:null;
}
async function readErrorCode(res){
  // Error response text is never returned, and not even retained.
  const limit=8192;
  const reader=res.body?.getReader();if(!reader)return null;
  let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done){text+=decoder.decode();break;}
      size+=value.byteLength;if(size>limit)return null;
      text+=decoder.decode(value,{stream:true});
    }
  }catch{return null;}
  finally{await reader.cancel().catch(()=>{});}
  try{return safeCode(JSON.parse(text));}catch{return null;}
}
export function createMoyskladOrderDiagnostic({fetcher=fetch}={}){
  return async({request,env})=>{
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    let url;try{url=new URL(request.url);}catch{return json(400,{code:'invalid_scope'});}
    if(url.origin!==ORIGIN||url.pathname!==PATH||url.search||url.hash)
      return json(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
      !env.OZON_FINANCE_DB)return json(503,{code:'owner_auth_unavailable'});
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
    const results=[];
    for(const probe of PROBES){
      let status=null,errorCode=null,networkError=false;
      try{
        const response=await fetcher(probe.url,{
          method:'GET',redirect:'manual',
          headers:{Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json'},
          signal:AbortSignal.timeout(12000)
        });
        status=response.status;
        if(status!==200)errorCode=await readErrorCode(response);
        else await response.body?.cancel().catch(()=>{});
      }catch{networkError=true;}
      results.push({probe:probe.id,http:status,errorCode,networkError});
      // If upstream is throttling, don't issue more requests.
      if(status===429)break;
    }
    const orders=results.find(x=>x.probe==='customerorder_default');
    const control=results.find(x=>x.probe==='productiontask_control');
    return json(200,{
      code:'moysklad_orders_diagnostic_ok',
      readOnly:true,changedRecords:0,approvedForWrite:false,
      customerOrderRead:orders?.http===200,
      productionTaskRead:control?.http===200,
      results,sampledAt:new Date().toISOString(),
      meaning:'HTTP_ONLY_NO_CUSTOMER_ORDER_DATA_NO_DUPLICATE_CLEARANCE'
    });
  };
}
export const onRequestGet=createMoyskladOrderDiagnostic();
