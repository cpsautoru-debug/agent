import {validBridgeSecret,verifyBridgeRequest} from '../../../workers/ms-production-bridge-auth.js';

// A fixed-scope server-to-server read bridge. It uses the EXISTING encrypted
// MS_API_TOKEN in Pages, never discloses its value and permits only two
// read-only MoySklad GET operations needed by the historical scanner.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-bridge';
const MS='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Vary':'X-MS-Bridge-Time, X-MS-Bridge-Signature'
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
export function parseBridgeScope(url){
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash)
    throw Error('invalid_bridge_scope');
  const keys=[...url.searchParams.keys()];
  const kind=url.searchParams.get('kind');
  if(kind==='tasks'&&keys.length===2&&keys.includes('offset')&&
    keys.filter(x=>x==='kind').length===1){
    const raw=url.searchParams.get('offset');
    if(!/^(0|[1-9]\d{0,5})$/.test(raw))throw Error('invalid_bridge_offset');
    const offset=Number(raw);
    if(offset%5!==0||offset>100000)throw Error('invalid_bridge_offset');
    const upstream=new URL(MS+'productiontask');
    upstream.searchParams.set('limit','5');
    upstream.searchParams.set('offset',String(offset));
    upstream.searchParams.set('order','moment,asc');
    return {url:upstream.toString(),limit:128*1024};
  }
  if(kind==='stages'&&keys.length===2&&keys.includes('taskId')&&
    keys.filter(x=>x==='kind').length===1){
    const taskId=url.searchParams.get('taskId');
    if(!UUID.test(taskId))throw Error('invalid_bridge_task');
    const upstream=new URL(MS+'productionstage');
    upstream.searchParams.set('limit','50');
    upstream.searchParams.set('offset','0');
    upstream.searchParams.set('expand','stage');
    upstream.searchParams.set('filter','productionTask='+MS+'productiontask/'+taskId.toLowerCase());
    return {url:upstream.toString(),limit:256*1024};
  }
  throw Error('invalid_bridge_scope');
}
async function limitedJsonBody(response,limit){
  const reader=response.body?.getReader();
  if(!reader)throw Error('missing_bridge_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let text='',bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done){text+=decoder.decode();break;}
      bytes+=value.byteLength;
      if(bytes>limit)throw Error('bridge_payload_too_large');
      text+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  JSON.parse(text);
  return text;
}
export function createProductionBridgeHandler({fetcher=fetch,now=Date.now}={}){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    if(!validBridgeSecret(env?.MS_PRODUCTION_BRIDGE_SECRET))
      return json(503,{code:'ms_bridge_secret_unavailable'});
    let url;
    try{url=new URL(request.url);}catch{return json(400,{code:'invalid_bridge_scope'});}
    let verified=false;
    try{
      verified=await verifyBridgeRequest(env.MS_PRODUCTION_BRIDGE_SECRET,
        request.headers.get('X-MS-Bridge-Time'),
        request.headers.get('X-MS-Bridge-Signature'),
        url.pathname+url.search,now());
    }catch{}
    if(!verified)return json(401,{code:'ms_bridge_unauthorized'});
    let scope;
    try{scope=parseBridgeScope(url);}
    catch{return json(400,{code:'invalid_bridge_scope'});}
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
      /\s/.test(env.MS_API_TOKEN))
      return json(503,{code:'ms_bridge_token_unavailable'});
    let response;
    try{
      response=await fetcher(scope.url,{
        method:'GET',redirect:'manual',
        headers:{
          Authorization:'Bearer '+env.MS_API_TOKEN,
          Accept:'application/json;charset=utf-8'
        },
        signal:AbortSignal.timeout(15000)
      });
    }catch{
      return json(502,{code:'ms_bridge_transport_error'});
    }
    if(response.status!==200){
      await response.body?.cancel().catch(()=>{});
      return json([401,403,429].includes(response.status)?response.status:502,
        {code:response.status===429?'ms_bridge_rate_limited':
          response.status===401?'ms_bridge_token_rejected':
          response.status===403?'ms_bridge_permission_denied':'ms_bridge_upstream_error'});
    }
    try{
      return new Response(await limitedJsonBody(response,scope.limit),{
        status:200,headers:HEADERS
      });
    }catch{
      return json(502,{code:'ms_bridge_unexpected_response'});
    }
  };
}
export const onRequestGet=createProductionBridgeHandler();
