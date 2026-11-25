import {verifySession} from '../auth/session.js';

// Targeted owner-only inspection. This endpoint NEVER writes to MoySklad.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/pegas-diagnostic';
const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCS=Object.freeze([
  {number:'07787',id:'b08463ce-d7c9-11f1-0a80-1ff10022127d',stage:'9eb9446c-d7c9-11f1-0a80-057e0023c02f'},
  {number:'08185',id:'fc8771c0-dfad-11f1-0a80-0c160020260a',stage:'f8893d90-dfad-11f1-0a80-0e690020bb7c'},
  {number:'08870',id:'6379aaf4-e7a6-11f1-0a80-08330001638f',stage:'e499966b-e77b-11f1-0a80-161d0000745c'}
]);
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const ref=(obj,kind)=>{
  const href=obj?.meta?.href;
  if(typeof href!=='string')return null;
  const m=new RegExp('^'+ROOT.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+kind+'/([0-9a-f-]{36})$','i').exec(href);
  return m&&UUID.test(m[1])?m[1].toLowerCase():null;
};
const quantity=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const short=s=>typeof s==='string'?s.slice(0,110):null;
async function boundedJson(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('missing_body');
  const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done){raw+=decoder.decode();break;}
      size+=value.byteLength;
      if(size>256*1024)throw Error('response_too_large');
      raw+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(raw);
}
const compactLines=rows=>Array.isArray(rows)?rows.slice(0,100).map(r=>({
  item:ref(r.assortment,'product')||ref(r.assortment,'variant')||null,
  consumedQuantity:quantity(r.consumedQuantity),
  quantity:quantity(r.quantity),
  producedQuantity:quantity(r.producedQuantity),
  processingPlan:ref(r.processingPlan,'processingplan')
})):null;
export function createPegasDiagnosticHandler(fetcher=fetch){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    const url=new URL(request.url);
    if(url.origin!==OFFICE||url.pathname!==PATH||url.search||url.hash)
      return json(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
    if(!sub)return json(401,{code:'owner_session_required'});
    const owner=await env.OZON_FINANCE_DB.prepare(
      "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
    ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
    if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
      return json(503,{code:'ms_token_unavailable'});
    let requests=0;
    const read=async (kind,id,part)=>{
      if(!['productionstagecompletion','productionstage','productiontask','processingplan'].includes(kind)||
         !UUID.test(id)||part&&!['materials','products','productionRows'].includes(part)||
         requests>=22)throw Error('invalid_read_scope');
      requests++;
      const response=await fetcher(ROOT+kind+'/'+id+(part?'/'+part:''),{
        method:'GET',redirect:'manual',
        headers:{Authorization:'Bearer '+env.MS_API_TOKEN,Accept:'application/json;charset=utf-8'},
        signal:AbortSignal.timeout(15000)
      });
      if(response.status!==200){
        await response.body?.cancel().catch(()=>{});
        return {error:response.status===401?'auth_failed':response.status===403?'permission_denied':response.status===404?'not_found':'upstream_error',http:response.status};
      }
      return boundedJson(response);
    };
    try{
      const output=[];
      for(const target of DOCS){
        const doc=await read('productionstagecompletion',target.id);
        const stage=await read('productionstage',target.stage);
        const docMatch=doc.id?.toLowerCase()===target.id&&doc.name===target.number;
        const stageMatch=stage.id?.toLowerCase()===target.stage;
        const taskId=ref(stage.productionTask,'productiontask')||ref(doc.productionTask,'productiontask');
        const task=taskId?await read('productiontask',taskId):null;
        const planId=ref(stage.processingPlan,'processingplan')||
          ref(task?.processingPlan,'processingplan')||ref(doc.processingPlan,'processingplan');
        const plan=planId?await read('processingplan',planId):null;
        const materials=docMatch?await read('productionstagecompletion',target.id,'materials'):null;
        const planMaterials=planId&&plan&&!plan.error?await read('processingplan',planId,'materials'):null;
        output.push({
          number:target.number,verifiedDocument:!!docMatch,verifiedStage:!!stageMatch,
          documentError:doc.error||null,stageError:stage.error||null,
          productionStageId:target.stage,productionTaskId:taskId,
          productionTaskNumber:short(task?.name),productionTaskError:task?.error||null,
          processingPlanId:planId,processingPlanName:short(plan?.name),processingPlanError:plan?.error||null,
          stagePlanned:quantity(stage.totalQuantity),stageCompleted:quantity(stage.completedQuantity),
          productionTaskFields:task&&!task.error?Object.keys(task).filter(x=>/plan|row|quantity|volume/i.test(x)):[],
          consumed:compactLines(materials?.rows),
          consumedError:materials?.error||null,
          planMaterials:compactLines(planMaterials?.rows),
          planMaterialsError:planMaterials?.error||null,
          needsManualNormMatch:!planId||!Array.isArray(planMaterials?.rows)
        });
      }
      return json(200,{code:'ms_pegas_diagnostic',readOnly:true,changedRecords:0,requests,
        note:'Do not infer excess without verifying units, production rows and processing-plan quantity',
        results:output});
    }catch{
      return json(502,{code:'ms_pegas_diagnostic_incomplete',readOnly:true,changedRecords:0,requests});
    }
  };
}
export const onRequestGet=createPegasDiagnosticHandler();
