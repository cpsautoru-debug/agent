import { verifySession } from '../auth/session.js';

const OFFICE_ORIGIN='https://autosklad63-office-staging.pages.dev';
const MS_ENDPOINT='https://api.moysklad.ru/api/remap/1.2/entity/productiontask?limit=1&offset=0';
const JSON_HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'Vary':'Cookie, Origin',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});

export function createMsProductionCheckHandler(fetcher=fetch){
  return async function onRequestGet({request,env}){
    try{
      if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
      const url=new URL(request.url);
      if(url.origin!==OFFICE_ORIGIN||url.search)return json(403,{code:'scope_denied'});
      if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
        return json(503,{code:'office_auth_not_configured'});
      const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
      if(!sub)return json(401,{code:'owner_session_required'});
      const owner=await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
      if(owner?.allowed!==1)return json(403,{code:'owner_only'});
      if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN.trim()||/\s/.test(env.MS_API_TOKEN))
        return json(503,{code:'ms_token_unavailable'});
      let response;
      try{
        response=await fetcher(MS_ENDPOINT,{
          method:'GET',
          headers:{
            Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json'
          },
          redirect:'manual',
          signal:AbortSignal.timeout(12000)
        });
      }catch(error){
        return json(502,{
          code:error?.name==='TimeoutError'?'ms_api_timeout':'ms_api_transport_error',
          upstreamHttp:null,
          readOnly:true
        });
      }
      if(response.status!==200){
        // MoySklad provides numeric API error codes inside "errors".
        // Expose only their first numeric code, not upstream messages, token, or headers.
        let msErrorCode=null;
        if(response.status===400||response.status===412||response.status===415){
          try{
            const contentLength=Number(response.headers.get('Content-Length')||0);
            if(contentLength<=8192){
              const errorBody=await response.text();
              if(errorBody.length<=8192){
                const parsed=JSON.parse(errorBody);
                const rawCode=parsed?.errors?.[0]?.code;
                if(Number.isSafeInteger(rawCode)&&rawCode>=0)msErrorCode=rawCode;
              }
            }
          }catch{} 
        }
        await response.body?.cancel().catch(()=>{});
        const code=({
          401:'ms_token_rejected_or_revoked',
          403:'ms_access_forbidden',
          404:'ms_production_endpoint_unavailable',
          429:'ms_rate_limited'
        })[response.status]||'ms_api_http_error';
        return json(200,{code,upstreamHttp:response.status,msErrorCode,readOnly:true,requests:1,changedRecords:0});
      }
      let result;
      try{
        const body=await response.text();
        if(body.length>262144)throw Error('body_too_large');
        const payload=JSON.parse(body);
        if(!Array.isArray(payload?.rows)||typeof payload?.meta?.size!=='number')throw Error('unexpected_response');
        const row=payload.rows[0]||null;
        result={
          code:'ms_production_read_ok',
          upstreamHttp:200,
          readOnly:true,
          requests:1,
          changedRecords:0,
          totalProductionTasks:payload.meta.size,
          sampleProductionTask:row?{
            number:typeof row.name==='string'?row.name.slice(0,64):null,
            id:typeof row.id==='string'?row.id:null,
            date:typeof row.moment==='string'?row.moment:null
          }:null
        };
      }catch{return json(200,{code:'ms_response_unrecognized',upstreamHttp:200,readOnly:true,requests:1,changedRecords:0});}
      return json(200,result);
    }catch{return json(503,{code:'ms_connection_check_unavailable',readOnly:true,changedRecords:0});}
  };
}
export const onRequestGet=createMsProductionCheckHandler();
