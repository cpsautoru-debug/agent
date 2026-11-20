import { verifySession } from '../auth/session.js';

const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-coverage-probe';
const BASE='https://api.moysklad.ru/api/remap/1.2/entity/';
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'Vary':'Cookie',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const TASK_REF=new RegExp('^https://api\\.moysklad\\.ru/api/remap/1\\.2/entity/productiontask/'+UUID+'$','i');
const ROW_REF=new RegExp('/(?:productionrow|productionRows)/'+UUID+'(?:$|\\?)','i');
// A nested production-row href may encode its parent production task.
// Standalone /productionrow/ URLs do not prove membership and stay unverified.
const NESTED_ROW_REF=new RegExp('^https://api\\.moysklad\\.ru/api/remap/1\\.2/entity/productiontask/('+UUID+')/productionRows/'+UUID+'$','i');
const PAGE_SIZE=50;
const TASK_ID=new RegExp('^'+UUID+'$','i');

// One or two bounded reads. The stage list requires a productionTask filter.
async function sampleCollection(fetcher,entity,token,taskId=null){
  const url=new URL(BASE+entity);
  url.searchParams.set('limit','1');
  url.searchParams.set('offset','0');
  if(entity==='productionstage'){
    if(typeof taskId!=='string'||!TASK_ID.test(taskId))throw Error('ms_response_unverified');
    url.searchParams.set('filter','productionTask='+BASE+'productiontask/'+taskId);
  }
  const response=await fetcher(url.toString(),{
    method:'GET',redirect:'manual',
    headers:{
      Authorization:'Bearer '+token,
      Accept:'application/json;charset=utf-8'
    },
    signal:AbortSignal.timeout(12000)
  });
  if(response.status!==200){
    await response.body?.cancel().catch(()=>{});
    const error=response.status===429?'ms_rate_limited':
      response.status===401?'ms_token_rejected':
      response.status===403?'ms_permission_denied':'ms_upstream_error';
    const failure=Error(error);
    // Keep only the numeric status. Never expose upstream body, headers or token.
    failure.upstreamHttp=response.status;
    throw failure;
  }
  const reader=response.body?.getReader();
  if(!reader)throw Error('ms_response_unverified');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,result='';
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done){result+=decoder.decode();break;}
      bytes+=value.byteLength;
      if(bytes>65536)throw Error('ms_response_unverified');
      result+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  let data;
  try{data=JSON.parse(result);}catch{throw Error('ms_response_unverified');}
  if(!Number.isSafeInteger(data?.meta?.size)||data.meta.size<0||
    data.meta.size>10000000||!Array.isArray(data.rows)||
    data.rows.length!==(data.meta.size===0?0:1))
    throw Error('ms_response_unverified');
  return {count:data.meta.size,sample:data.rows[0]||null};
}

export function summarizeProductionCoverageProbe(tasks,stages){
  if((tasks?.count===0&&stages!==null)||(tasks?.count>0&&stages===null))
    throw Error('invalid_probe_stage_scope');
  for(const r of [tasks,...(stages?[stages]:[])]){
    if(!Number.isSafeInteger(r?.count)||r.count<0||r.count>10000000)
      throw Error('invalid_probe_count');
  }
  const stage=stages?.sample||null;
  const taskLink=stage?.productionTask?.meta?.href;
  const rowLink=stage?.productionRow?.meta?.href;
  const rowParent=typeof rowLink==='string'?NESTED_ROW_REF.exec(rowLink):null;
  const sampleId=tasks?.sample?.id;
  const rowParentMatch=rowParent&&typeof sampleId==='string'&&TASK_ID.test(sampleId)?
    (rowParent[1].toLowerCase()===sampleId.toLowerCase()?'matched':'conflicting'):
    'not_observed';
  // A mismatched nested row parent is an integrity failure, not a normal result.
  if(rowParentMatch==='conflicting')throw Error('ms_response_unverified');
  const linkPresent=stage===null?'not_observed':
    typeof taskLink==='string'&&TASK_REF.test(taskLink)?'observed':'not_observed';
  const rowPresent=stage===null?'not_observed':
    typeof rowLink==='string'&&ROW_REF.test(rowLink)?'observed':'not_observed';
  return {
    code:'ms_production_coverage_probe_ok',
    readOnly:true,ownerOnly:true,requests:stages===null?1:2,changedRecords:0,
    coverage:'CAPABILITY_SAMPLE_ONLY_NO_FULL_SCAN',
    totalTaskDocuments:tasks.count,
    // The list cannot provide a global stage count without task filtering.
    totalProductionStages:null,
    sampleTaskStageCount:stages?.count??null,
    stageListScope:stages===null?'NO_TASK_TO_SAMPLE':'ONE_PRODUCTION_TASK_FILTERED',
    estimatedTaskListPages50:Math.max(1,Math.ceil(tasks.count/PAGE_SIZE)),
    estimatedStageListPages50:null,
    sampleTaskStagePages50:stages===null?null:Math.ceil(stages.count/PAGE_SIZE),
    sampleStageHasTaskReference:linkPresent,
    sampleStageHasRowReference:rowPresent,
    sampleRowTaskMatch:rowParentMatch,
    bulkStageJoinProven:false,
    globalStageListAvailable:false,
    allUnfinishedVerified:false,
    verifiedUnfinishedCount:null,
    // Runtime costs, pagination stability and matching stages must be verified
    // before enabling any multi-page scan or making statements of coverage.
    nextStep:'VALIDATE_PER_TASK_STAGE_PAGINATION_BEFORE_SCAN'
  };
}

export function createProductionCoverageProbeHandler(fetcher=fetch){
  return async function({request,env}){
    try{
      if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
      const url=new URL(request.url);
      if(url.origin!==OFFICE||url.pathname!==PATH||url.search||url.hash)
        return json(400,{code:'invalid_probe_scope'});
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
      let upstreamEntity='productiontask';
      try{
        // Always sequential: 1 GET productiontask + 1 GET productionstage.
        // Never follow any links contained in upstream data.
        const tasks=await sampleCollection(fetcher,upstreamEntity,env.MS_API_TOKEN);
        if(tasks.count===0)return json(200,summarizeProductionCoverageProbe(tasks,null));
        const taskId=tasks.sample?.id;
        if(typeof taskId!=='string'||!TASK_ID.test(taskId))throw Error('ms_response_unverified');
        upstreamEntity='productionstage';
        const stages=await sampleCollection(fetcher,upstreamEntity,env.MS_API_TOKEN,taskId);
        return json(200,summarizeProductionCoverageProbe(tasks,stages));
      }catch(e){
        const allow=['ms_rate_limited','ms_token_rejected','ms_permission_denied',
          'ms_response_unverified','ms_upstream_error'];
        return json(502,{code:allow.includes(e?.message)?e.message:
          e?.name==='TimeoutError'?'ms_timeout':'ms_transport_error',
          // Fixed collection enum and HTTP integer only; never a server message.
          upstreamEntity,
          upstreamHttp:Number.isInteger(e?.upstreamHttp)&&
            e.upstreamHttp>=300&&e.upstreamHttp<=599?e.upstreamHttp:null,
          readOnly:true,changedRecords:0,coverage:'NOT_VERIFIED'});
      }
    }catch{
      return json(503,{code:'ms_probe_unavailable',readOnly:true,changedRecords:0});
    }
  };
}
export const onRequestGet=createProductionCoverageProbeHandler();
