import {verifySession} from '../auth/session.js';

// Bounded owner-only read of FULL stock and processing-plan lists.
// Plan materials are sampled separately. No MoySklad or D1 writes.
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/complete-first-two-audit';
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const MAX_PAGES=8,LIMIT=100,MAX_BOM=4;
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const safe=x=>Number.isSafeInteger(x)&&x>=0;
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e9?x:null;
const label=(s,n=120)=>typeof s==='string'&&s.length<=n&&
 !/[\u0000-\u001f\u007f]/.test(s)?s:null;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTIONS={
 stock:'report/stock/bystore',
 techcards:'entity/processingplan'
};
async function get(fetcher,token,path){
 let response;
 try{response=await fetcher(BASE+path,{method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},
  signal:AbortSignal.timeout(12000)})}
 catch{return {error:'transport_or_timeout'};}
 if(response.status!==200){
  await response.body?.cancel().catch(()=>{});
  return {error:response.status===429?'rate_limited':
   response.status===401?'token_rejected':
   response.status===403?'permission_denied':'upstream_unavailable',
   status:response.status};
 }
 try{
  const raw=await response.text();
  if(raw.length>600000)return {error:'response_exceeds_limit'};
  const value=JSON.parse(raw);
  if(!Array.isArray(value?.rows)||!safe(value.meta?.size))
   return {error:'unexpected_collection_shape'};
  return {value};
 }catch{return {error:'invalid_json'};}
}
async function scan(fetcher,token,kind){
 const rows=[];let expected=null,err=null;
 for(let page=0;page<MAX_PAGES;page++){
  const url=COLLECTIONS[kind]+'?limit='+LIMIT+'&offset='+(page*LIMIT)+
   (kind==='stock'?'&groupBy=variant':'');
  const part=await get(fetcher,token,url);
  if(part.error){err=part.error;break;}
  const data=part.value;
  if(expected===null)expected=data.meta.size;
  if(expected!==data.meta.size||data.rows.length>LIMIT||
   (data.rows.length===0&&rows.length<expected)){
   err='pagination_changed_or_incomplete';break;
  }
  rows.push(...data.rows);
  if(rows.length>=expected)break;
 }
 return {rows,total:expected,
  complete:expected!==null&&rows.length===expected&&!err,
  error:err};
}
function stockSummary(result){
 let checked=0,negatives=[],unknown=0,reserved=0;
 const warehouses=new Set(),byWarehouse={};
 for(const row of result.rows){
  for(const store of Array.isArray(row.stockByStore)?row.stockByStore:[]){
   const name=label(store.name);
   const q=finite(store.stock),r=finite(store.reserve);
   checked++;
   if(name)warehouses.add(name);
   if(q===null)unknown++;
   if(r!==null&&r>0)reserved++;
   if(name&&q!==null&&q<0){
    byWarehouse[name]=(byWarehouse[name]??0)+1;
    if(negatives.length<60)negatives.push({
     itemId:UUID.test(row.meta?.href?.split('/').pop()||'')?
      row.meta.href.split('/').pop():null,
     warehouse:name,quantity:q,reserve:r
    });
   }
  }
 }
 return {totalPositions:result.total,positionsRead:result.rows.length,
  completeReportPages:result.complete,problem:result.error,
  checkedWarehouseLines:checked,warehouses:[...warehouses],
  negativeWarehouseLines:Object.values(byWarehouse).reduce((a,b)=>a+b,0),
  negativeByWarehouse:byWarehouse,negativeSample:negatives,
  invalidStockNumbers:unknown,reservedLines:reserved,
  note:'Report pages are not atomic. Negative counts reflect this read, not necessarily the live balance later.'};
}
function planSummary(result){
 const names=result.rows.map(row=>({id:UUID.test(row.id||'')?row.id:null,
  name:label(row.name),updated:label(row.updated,40),
  archived:row.archived===true}));
 const namesVesta=names.filter(x=>/веста|vesta|приор|priora|искр|iskra|самар|samara/i
  .test(x.name||''));
 const picks=[];
 const matchGroups=[/перфорац/i,/альк|кокетк/i,/приор/i,/веста|vesta/i];
 for(const re of matchGroups){
  const item=namesVesta.find(x=>re.test(x.name||'')&&x.id&&
   !picks.some(p=>p.id===x.id));
  if(item)picks.push(item);
 }
 return {totalPlans:result.total,plansRead:names.length,
  completePlanPages:result.complete,problem:result.error,
  activeInSample:names.filter(x=>!x.archived).length,
  knownModelPlans:namesVesta.length,
  sampleNames:namesVesta.slice(0,18),picks:picks.slice(0,MAX_BOM)};
}
async function materialSample(fetcher,token,plans){
 const findings=[];
 for(const item of plans){
  const part=await get(fetcher,token,'entity/processingplan/'+item.id+
   '/materials?limit=100&offset=0');
  if(part.error){findings.push({name:item.name,id:item.id,
   status:part.error});continue;}
  const lines=part.value.rows,flags=[];
  for(const row of lines){
   const quantity=finite(row.quantity);
   if(quantity===null||quantity<=0)
    flags.push({quantity,reason:quantity===null?
     'missing_or_non_numeric_quantity':'nonpositive_quantity'});
  }
  findings.push({name:item.name,id:item.id,
   status:'sampled',linesFound:part.value.meta.size,
   linesShown:lines.length,complete:lines.length===part.value.meta.size,
   invalidNorms:flags.length,invalidNormSample:flags.slice(0,10),
   materials:lines.slice(0,45).map(row=>({
    quantity:finite(row.quantity),
    materialType:label(row.assortment?.meta?.type,40)||
     label(row.material?.meta?.type,40),
    materialId:UUID.test(row.assortment?.meta?.href?.split('/').pop()||'')?
      row.assortment.meta.href.split('/').pop():null
   }))});
 }
 return findings;
}
export function createCompleteFirstTwoAudit({fetcher=fetch}={}){
 return async function({request,env}){
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  let u;try{u=new URL(request.url);}catch{return json(400,{code:'invalid_scope'});}
  const keys=[...u.searchParams.keys()];
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.hash||
   keys.some(k=>k!=='utm_source')||
   u.searchParams.getAll('utm_source').length>1)
   return json(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
     !env.OZON_FINANCE_DB)return json(503,{code:'auth_unavailable'});
  let sub;try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return json(401,{code:'owner_session_required'});}
  if(!sub)return json(401,{code:'owner_session_required'});
  try{
   const found=await env.OZON_FINANCE_DB.prepare(
    "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1"
   ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(found?.allowed!==1)return json(403,{code:'owner_only'});
  }catch{return json(503,{code:'auth_unavailable'});}
  if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||
   /\s/.test(env.MS_API_TOKEN))return json(503,{code:'ms_token_unavailable'});
  const stock=await scan(fetcher,env.MS_API_TOKEN,'stock');
  const tech=await scan(fetcher,env.MS_API_TOKEN,'techcards');
  const p=planSummary(tech);
  const materials=await materialSample(fetcher,env.MS_API_TOKEN,p.picks);
  return json(200,{code:'ms_complete_first_two_audit',
   readOnly:true,changedRecords:0,requestedApiCalls:
    Math.ceil(stock.rows.length/LIMIT)+Math.ceil(tech.rows.length/LIMIT)+materials.length,
   checkedAt:new Date().toISOString(),
   warehousesExpected:6, // From previous owner sample; not asserted as live count.
   stock:stockSummary(stock),
   techcards:{...p,picks:undefined},materialSamples:materials,
   fullBOMAuditComplete:false,
   note:'Full lists scanned where complete=true; only 4 selected BOMs checked, no modifications.'});
 };
}
export const onRequestGet=createCompleteFirstTwoAudit();
