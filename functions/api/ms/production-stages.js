import { verifySession } from '../auth/session.js';

const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-stages';
const BASE='https://api.moysklad.ru/api/remap/1.2/entity/productionstage';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff',
  'Vary':'Cookie'
};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const isQty=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000;
const short=(s,max=120)=>typeof s==='string'&&s.length<=max?s:null;
const rowId=(reference)=>{
  const href=reference?.meta?.href;
  const match=typeof href==='string'&&href.match(/\/(?:productionrow|productionRows)\/([a-f0-9-]{36})(?:\?|$)/i);
  if(match&&UUID.test(match[1]))return match[1].toLowerCase();
  return typeof reference?.id==='string'&&UUID.test(reference.id)?reference.id.toLowerCase():null;
};
async function jsonWithLimit(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('missing_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done){text+=decoder.decode();break;}
      bytes+=value.byteLength;
      if(bytes>256*1024)throw Error('oversized_body');
      text+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(text);
}
function compactQuantity(n){
  return Math.round(n*1000)/1000;
}
export function summarizeStages(payload){
  if(!Array.isArray(payload?.rows)||payload.rows.length>50||
    !Number.isInteger(payload?.meta?.size)||payload.meta.size<0||
    payload.meta.size>50||payload.rows.length!==payload.meta.size)
    throw Error('stage_list_incomplete');
  const stageItems=[];
  for(const entry of payload.rows){
    if(!entry||!isQty(entry.totalQuantity)||!isQty(entry.completedQuantity)||
      !Number.isInteger(entry.orderingPosition)||entry.orderingPosition<0||
      entry.orderingPosition>100||entry.completedQuantity>entry.totalQuantity)
      throw Error('stage_fields_unverified');
    const position=rowId(entry.productionRow);
    if(!position)throw Error('stage_row_reference_missing');
    const name=short(entry.stage?.name,80) || ('Этап '+(entry.orderingPosition+1));
    stageItems.push({
      productionRowId:position,
      order:entry.orderingPosition,
      stageName:name,
      plan:entry.totalQuantity,
      done:entry.completedQuantity
    });
  }
  const positions=new Map(), stages=new Map();
  for(const s of stageItems){
    let position=positions.get(s.productionRowId);
    if(!position){position={plan:s.plan,items:[]};positions.set(s.productionRowId,position);}
    if(position.items.some(x=>x.order===s.order))throw Error('duplicate_row_stage');
    if(Math.abs(position.plan-s.plan)>0.000001)throw Error('inconsistent_row_plan');
    position.items.push(s);
    const key=s.order+'|'+s.stageName;
    let stage=stages.get(key);
    if(!stage){stage={name:s.stageName,order:s.order,plan:0,done:0};stages.set(key,stage);}
    stage.plan+=s.plan;
    stage.done+=s.done;
  }
  let planned=0,finished=0;
  for(const pos of positions.values()){
    planned+=pos.plan;
    const finalStage=pos.items.reduce((a,b)=>a.order>b.order?a:b);
    finished+=finalStage.done;
  }
  const list=[...stages.values()]
    .sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ru'))
    .map(({order,name,plan,done})=>({order,name,plan:compactQuantity(plan),done:compactQuantity(done)}));
  return {
    code:'ms_production_stages_ok',readOnly:true,changedRecords:0,requests:1,
    taskRows:positions.size,plan:compactQuantity(planned),
    finishedFinalStage:compactQuantity(finished),
    finalStageMetric:'COMPLETED_QUANTITY_AT_LAST_STAGE_PER_PRODUCTION_ROW',
    stages:list,
    coverage:'ONE_PRODUCTION_TASK_ONLY_NOT_ALL_ACTIVE_TASKS'
  };
}
export function createStageHandler(fetcher=fetch){
  return async function({request,env}){
    try{
      if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
      const url=new URL(request.url);
      const ids=url.searchParams.getAll('taskId');
      if(url.origin!==OFFICE||url.pathname!==PATH||
        [...url.searchParams.keys()].some(x=>x!=='taskId')||
        ids.length!==1||!UUID.test(ids[0]))
        return json(400,{code:'invalid_task_scope'});
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
      const upstream=new URL(BASE);
      // Reference filters require the full entity href, not just its UUID.
      upstream.searchParams.set('filter','productionTask=https://api.moysklad.ru/api/remap/1.2/entity/productiontask/'+ids[0]);
      upstream.searchParams.set('limit','50');
      upstream.searchParams.set('offset','0');
      upstream.searchParams.set('expand','stage');
      let response;
      try{
        response=await fetcher(upstream.toString(),{
          method:'GET',redirect:'manual',
          headers:{
            Authorization:'Bearer '+env.MS_API_TOKEN,
            Accept:'application/json;charset=utf-8'
          },
          signal:AbortSignal.timeout(25000)
        });
      }catch(error){
        return json(502,{code:error?.name==='TimeoutError'?'ms_stages_timeout':'ms_stages_transport_error',readOnly:true,changedRecords:0});
      }
      if(response.status!==200){
        // Only a numeric API error code is safe to expose; never include
        // upstream messages, headers, entity data or the bearer token.
        let msErrorCode=null;
        if([400,412,415,422].includes(response.status)){
          try{
            const responseLength=Number(response.headers.get('Content-Length')||0);
            if(responseLength<=8192){
              const parsed=await jsonWithLimit(response);
              const n=parsed?.errors?.[0]?.code;
              if(Number.isSafeInteger(n)&&n>=0)msErrorCode=n;
            }
          }catch{}
        }
        await response.body?.cancel().catch(()=>{});
        return json(502,{
          code:response.status===401?'ms_token_rejected':
            response.status===403?'ms_permission_denied':
            response.status===429?'ms_rate_limited':'ms_stages_upstream_error',
          upstreamHttp:response.status,msErrorCode,readOnly:true,changedRecords:0
        });
      }
      try{
        return json(200,{...summarizeStages(await jsonWithLimit(response)),upstreamHttp:200});
      }catch{
        return json(502,{code:'ms_stages_unverified',readOnly:true,changedRecords:0});
      }
    }catch{
      return json(503,{code:'ms_stages_unavailable',readOnly:true,changedRecords:0});
    }
  };
}
export const onRequestGet=createStageHandler();
