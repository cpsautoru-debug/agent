// Safe, anonymous, GET-only smoke check for Cloudflare Pages branch preview.
// Never sends a token or cookie and never invokes the owner-only API with credentials.
import {pathToFileURL} from 'node:url';

const PROJECT_HOST='autosklad63-office-staging.pages.dev';
const TIMEOUT_MS=10000;
const MAX_BODY_BYTES=128*1024;

export function assertPreviewOrigin(value){
  let origin;
  try{origin=new URL(value);}catch{throw Error('invalid_preview_url');}
  if(origin.protocol!=='https:'||
     !origin.hostname.endsWith('.'+PROJECT_HOST)||
     origin.hostname===PROJECT_HOST||
     origin.username||origin.password||origin.port||
     origin.pathname!=='/'||origin.search||origin.hash)
    throw Error('preview_origin_required');
  return origin.origin;
}

async function readLimited(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('response_body_missing');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let text='',bytes=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done){text+=decoder.decode();break;}
      bytes+=value.byteLength;
      if(bytes>MAX_BODY_BYTES)throw Error('response_too_large');
      text+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return text;
}

async function getPublic(fetcher,origin,path){
  const response=await fetcher(origin+path,{
    method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',
    headers:{Accept:path.startsWith('/api/')?'application/json':'*/*'},
    signal:AbortSignal.timeout(TIMEOUT_MS)
  });
  return {status:response.status,type:response.headers.get('Content-Type')||'',
    cache:response.headers.get('Cache-Control')||'',
    body:await readLimited(response)};
}

export async function verifyProductionPreview(originValue,fetcher=fetch){
  const origin=assertPreviewOrigin(originValue);
  const steps=[];
  const html=await getPublic(fetcher,origin,'/');
  if(html.status!==200||!/text\/html/i.test(html.type)||
    !html.body.includes('id="msCoverageProbeStart"')||
    !html.body.includes('src="ms-production-coverage-probe.mjs"'))
    throw Error('preview_html_not_current');
  steps.push('html_ready');
  for(const path of ['/ms-production-coverage-probe.mjs','/ms-production-scan-budget.mjs']){
    const asset=await getPublic(fetcher,origin,path);
    if(asset.status!==200||
      !/(javascript|ecmascript)/i.test(asset.type)||
      !asset.body.includes('export')&&!asset.body.includes('msCoverageProbeStart'))
      throw Error('preview_js_not_ready');
    steps.push('asset_ready');
  }
  const api=await getPublic(fetcher,origin,'/api/ms/production-coverage-probe');
  if(api.status!==401||!/application\/json/i.test(api.type)||
    !api.cache.toLowerCase().includes('no-store'))
    throw Error('preview_auth_guard_not_ready');
  let body;
  try{body=JSON.parse(api.body);}catch{throw Error('preview_api_not_json');}
  if(body?.code!=='owner_session_required')
    throw Error('preview_auth_guard_not_ready');
  steps.push('owner_only_guard_ready');
  return {code:'ms_preview_smoke_ok',scope:'ANONYMOUS_GET_ONLY',
    origin,steps,liveOwnerProbeExecuted:false,changedRecords:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const origin=process.argv[2];
  verifyProductionPreview(origin).then(result=>{
    process.stdout.write(JSON.stringify(result)+'\n');
  }).catch(error=>{
    const allowed=new Set(['invalid_preview_url','preview_origin_required',
      'response_body_missing','response_too_large','preview_html_not_current',
      'preview_js_not_ready','preview_auth_guard_not_ready','preview_api_not_json']);
    process.stderr.write('Preview smoke: '+
      (allowed.has(error?.message)?error.message:'network_or_transport_error')+'\n');
    process.exitCode=1;
  });
}
