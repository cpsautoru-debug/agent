import { verifySession } from '../auth/session.js';

const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-feed';
const UPSTREAM='https://api.moysklad.ru/api/remap/1.2/entity/productiontask?limit=20&offset=0&order=moment,desc';
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  'Vary':'Cookie'
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

async function limitedJson(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('missing_response_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,result='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done){result+=decoder.decode();break;}
      bytes+=value.byteLength;
      if(bytes>256*1024)throw Error('body_limit');
      result+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(result);
}

export function summarizeProductionFeed(payload){
  if(!Number.isInteger(payload?.meta?.size)||payload.meta.size<0||
    !Array.isArray(payload?.rows)||payload.rows.length>20)
    throw Error('invalid_production_feed');
  const records=payload.rows.map(row=>{
    if(!row||typeof row.name!=='string'||row.name.length>80||
      typeof row.moment!=='string'||row.moment.length>40||
      !/^\d{4}-\d{2}-\d{2}/.test(row.moment))
      throw Error('invalid_production_task');
    return {number:row.name,date:row.moment,
      updated:typeof row.updated==='string'&&row.updated.length<=40?row.updated:null};
  });
  return {
    code:'ms_production_feed_ok',source:'MOYSKLAD_JSON_API',
    readOnly:true,requests:1,changedRecords:0,
    totalAllTime:payload.meta.size,
    selection:'LATEST_20_BY_DOCUMENT_DATE_NOT_ACTIVE_TASKS',
    records
  };
}

export function createProductionFeedHandler(fetcher=fetch){
  return async function({request,env}){
    try{
      if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
      const url=new URL(request.url);
      if(url.origin!==OFFICE||url.pathname!==PATH||url.search)
        return json(403,{code:'scope_denied'});
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
        response=await fetcher(UPSTREAM,{
          method:'GET',redirect:'manual',
          headers:{
            Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json;charset=utf-8'
          },
          signal:AbortSignal.timeout(12000)
        });
      }catch(error){
        return json(502,{code:error?.name==='TimeoutError'?'ms_timeout':'ms_transport_error',
          readOnly:true,changedRecords:0});
      }
      if(response.status!==200){
        await response.body?.cancel().catch(()=>{});
        return json(502,{code:response.status===401?'ms_token_rejected':
          response.status===403?'ms_permission_denied':
          response.status===429?'ms_rate_limited':'ms_upstream_error',
          upstreamHttp:response.status,readOnly:true,changedRecords:0});
      }
      try{
        return json(200,{...summarizeProductionFeed(await limitedJson(response)),upstreamHttp:200});
      }catch{
        return json(502,{code:'ms_unexpected_response',readOnly:true,changedRecords:0});
      }
    }catch{
      return json(503,{code:'ms_production_feed_unavailable',readOnly:true,changedRecords:0});
    }
  };
}
export const onRequestGet=createProductionFeedHandler();
