import {verifySession} from '../auth/session.js';

// Owner-only read of four verified completion documents and their parent
// production stages. No writes, no arbitrary upstream URL following.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/production-stage-root-causes';
const API='https://api.moysklad.ru/api/remap/1.2/';
const DOCS=[
 {number:'00251',document:'5f218f91-3846-11f1-0a80-1b6e00018269',stage:'5bec5d79-3846-11f1-0a80-106c0001518c',expected:-304},
 {number:'00725',document:'b3d75c45-49e9-11f1-0a80-014b000703d7',stage:'b026e970-49e9-11f1-0a80-071300078500',expected:-196},
 {number:'01514',document:'a1ae0153-5fa8-11f1-0a80-15f400025540',stage:'9c58d200-5fa8-11f1-0a80-019f0001e78c',expected:-263},
 {number:'02299',document:'39c8571a-6fe8-11f1-0a80-1bf700131a30',stage:'35fcafaf-6fe8-11f1-0a80-1bf7001319b4',expected:-228}
];
const MATERIALS={film:'f3974a16-3845-11f1-0a80-1d900001798c',
 spunbond:'fdafcb03-3845-11f1-0a80-0e8e0001aa8c'};
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,obj)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const string=(x,max=100)=>typeof x==='string'&&x.length<=max&&
 !/[\u0000-\u001f\u007f]/.test(x)?x:null;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x)?x:null;
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10000000?x:null;
const reference=x=>{
 const href=x?.meta?.href;
 if(typeof href!=='string'||href.length>400)return null;
 try{
  const u=new URL(href),m=u.pathname.match(/^\/api\/remap\/1\.2\/entity\/([a-z]+)\/([a-f0-9-]{36})$/i);
  if(u.origin!=='https://api.moysklad.ru'||!m||!uuid(m[2]))return null;
  return {type:string(m[1],50),id:m[2]};
 }catch{return null;}
};
// Show only safe relative API reference paths, never the auth token or source URL.
const pathReference=x=>{
 const href=x?.meta?.href;
 if(typeof href!=='string'||href.length>420)return null;
 try{
  const u=new URL(href);
  return u.origin==='https://api.moysklad.ru'&&
   /^\/api\/remap\/1\.2\/(entity|report)\/[a-z0-9\/-]+$/i.test(u.pathname)?
   u.pathname.replace('/api/remap/1.2/',''):null;
 }catch{return null;}
};
async function get(fetcher,token,path){
 let r;
 try{r=await fetcher(API+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(13000)})}catch{return {error:'transport_or_timeout'};}
 if(r.status!==200){
  let msCode=null;
  if([400,412,422].includes(r.status))try{
   const raw=(await r.text()).slice(0,3000),e=JSON.parse(raw)?.errors?.[0];
   if(Number.isSafeInteger(e?.code))msCode=e.code;
  }catch{}
  await r.body?.cancel().catch(()=>{});
  return {error:r.status===429?'rate_limited':r.status===401?'invalid_token':
   r.status===403?'permission_denied':'upstream_http',status:r.status,msCode};
 }
 try{
  const raw=await r.text();
  if(raw.length>320000)return {error:'too_large'};
  return {value:JSON.parse(raw)};
 }catch{return {error:'invalid_json'};}
}
function compactLine(x){
 const referenceValue=reference(x?.assortment)||reference(x?.material)||
  reference(x?.product);
 return {assortment:referenceValue,
  quantity:num(x?.quantity),consumedQuantity:num(x?.consumedQuantity),
  producedQuantity:num(x?.producedQuantity),productionVolume:num(x?.productionVolume),
  fieldsPresent:Object.keys(x||{}).slice(0,18)};
}
async function lines(fetcher,token,path){
 const res=await get(fetcher,token,path);
 if(res.error)return {status:res.error,http:res.status||null,
  msCode:res.msCode||null};
 const v=res.value;
 if(!Array.isArray(v?.rows)||!Number.isSafeInteger(v.meta?.size))
  return {status:'unexpected_collection_shape',keys:Object.keys(v||{}).slice(0,18)};
 const matches={};
 for(const [key,id] of Object.entries(MATERIALS))
  matches[key]=v.rows.filter(x=>compactLine(x).assortment?.id===id)
   .map(x=>num(x.consumedQuantity));
 return {status:'ok',total:v.meta.size,complete:v.meta.size===v.rows.length,
  filmAndSpunbond:matches,
  sample:v.rows.slice(0,14).map(compactLine)};
}
export function createRootCauseHandler({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url);}catch{return reply(400,{code:'invalid_url'});}
  if(u.origin!==OFFICE||u.pathname!==PATH||u.hash||
   [...u.searchParams.keys()].some(k=>k!=='utm_source')||
   u.searchParams.getAll('utm_source').length>1)
   return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB)return reply(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return reply(401,{code:'owner_session_required'});}
  if(!sub)return reply(401,{code:'owner_session_required'});
  try{
   const owner=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return reply(503,{code:'ms_token_unavailable'});
  const token=env.MS_API_TOKEN,results=[];
  // 12 bounded read calls: four stages and two subordinate collections each.
  for(const d of DOCS){
   const stage=await get(fetcher,token,'entity/productionstage/'+d.stage);
   const result={number:d.number,expectedEach:d.expected,
    documentId:d.document,stageId:d.stage};
   if(stage.error){
    result.stageStatus=stage.error;result.stageHttp=stage.status||null;
    result.stageErrorCode=stage.msCode||null;
   }else{
    const v=stage.value;
    result.stageStatus=uuid(v.id)===d.stage?'ok':'unverified_stage';
    result.stageFields=Object.keys(v||{}).slice(0,30);
    result.stageName=string(v.name);
    result.productionTask=reference(v.productionTask);
    result.productionRow=reference(v.productionRow);
    result.productionRowPath=pathReference(v.productionRow);
    result.productionRowFields=v.productionRow&&typeof v.productionRow==='object'?
     Object.keys(v.productionRow).slice(0,20):[];
    result.processingPlan=reference(v.processingPlan);
    result.productionStageDefinition=reference(v.stage);
    result.stageMaterialsReference=reference(v.materials);
    result.stageMaterialsPath=pathReference(v.materials);
    result.stageMaterialsFields=v.materials&&typeof v.materials==='object'?
     Object.keys(v.materials).slice(0,20):[];
    result.totalQuantity=num(v.totalQuantity);
    result.completedQuantity=num(v.completedQuantity);
   }
   const base='entity/productionstagecompletion/'+d.document;
   result.documentMaterials=await lines(fetcher,token,base+'/materials?limit=100');
   result.documentProducts=await lines(fetcher,token,base+'/products?limit=100');
   results.push(result);
   if(result.stageStatus==='rate_limited'||
     result.documentMaterials.status==='rate_limited'||
     result.documentProducts.status==='rate_limited')break;
  }
  // Resolve the one production output seen on stage 00251 and the common
  // processing-stage definition once, rather than repeat per completion.
  const output=await get(fetcher,token,
   'entity/product/d5eba0c7-3845-11f1-0a80-160300017f1a');
  const definition=await get(fetcher,token,
   'entity/processingstage/0ff1a8f1-9897-11f0-0a80-0f0b00152526');
  return reply(200,{code:'ms_production_stage_root_causes',
   readOnly:true,changedRecords:0,checkedAt:new Date().toISOString(),
   checked:results.length,expected:4,
   outputItem:output.error?{status:output.error,http:output.status||null}:{
    status:'ok',id:uuid(output.value?.id),
    name:string(output.value?.name,180),code:string(output.value?.code,60),
    path:string(output.value?.pathName,180)},
   stageDefinition:definition.error?{status:definition.error,http:definition.status||null}:{
    status:'ok',id:uuid(definition.value?.id),
    name:string(definition.value?.name,150),
    fieldsPresent:Object.keys(definition.value||{}).slice(0,20)},
   results,note:'Read-only document and stage links. 991 identical film/spunbond deductions confirmed via turnover; this report checks what each document contains. Never auto-adjust inventory based on these results.'});
 };
}
export const onRequestGet=createRootCauseHandler();
