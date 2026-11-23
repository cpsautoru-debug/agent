import {verifySession} from '../auth/session.js';

// Read-only Ozon order API health check. No MoySklad calls, no orders/PII
// leave the server and no financial or inventory state is modified.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ozon/orders-readiness';
const HEADER={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','Vary':'Cookie',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(status,v)=>new Response(JSON.stringify(v),{status,headers:HEADER});
const MAX_BYTES=64*1024;
async function parseBounded(res){
  const reader=res.body?.getReader();if(!reader)throw Error('missing_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,s='';
  try{for(;;){
    const {done,value}=await reader.read();
    if(done){s+=decoder.decode();break;}
    bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('too_large');
    s+=decoder.decode(value,{stream:true});
  }}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(s);
}
export function createOzonOrdersReadiness({fetcher=fetch,now=Date.now}={}){
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
    const token=env.OZON_API_KEY,client=String(env.OZON_CLIENT_ID||'');
    if(typeof token!=='string'||!token||/\s/.test(token)||
      !/^[0-9]{1,20}$/.test(client))
      return json(503,{code:'ozon_credentials_unavailable'});
    const until=new Date(now()),since=new Date(now()-7*86400000);
    try{
      const response=await fetcher('https://api-seller.ozon.ru/v3/posting/fbo/list',{
        method:'POST',redirect:'manual',headers:{
          'Client-Id':client,'Api-Key':token,
          Accept:'application/json','Content-Type':'application/json'
        },body:JSON.stringify({filter:{
          since:since.toISOString(),to:until.toISOString()
        },limit:1,offset:0,dir:'DESC'}),signal:AbortSignal.timeout(12000)
      });
      if(response.status!==200){
        await response.body?.cancel().catch(()=>{});
        return json(200,{code:'ozon_orders_readiness',readOnly:true,
          checkedAt:until.toISOString(),ready:false,
          status:response.status===403?'permission_denied':
            response.status===401?'token_rejected':
            response.status===429?'rate_limited':'upstream_error',
          http:response.status,changedRecords:0});
      }
      const data=await parseBounded(response);
      const rows=data?.result?.postings??data?.postings;
      if(!Array.isArray(rows)||rows.length>1||
        rows.some(x=>typeof x?.posting_number!=='string'||
          !x.posting_number||typeof x?.status!=='string'))
        throw Error('schema_unverified');
      return json(200,{code:'ozon_orders_readiness',readOnly:true,
        checkedAt:until.toISOString(),ready:true,status:'verified',
        http:200,checkedSample:rows.length,changedRecords:0});
    }catch{
      return json(200,{code:'ozon_orders_readiness',readOnly:true,
        checkedAt:until.toISOString(),ready:false,
        status:'unverified_response',http:null,changedRecords:0});
    }
  };
}
export const onRequestGet=createOzonOrdersReadiness();
