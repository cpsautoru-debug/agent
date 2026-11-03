import { verifySession } from '../auth/session.js';
import { calculateProfit, validateProfitDocument, normalizeProfitWorkbook, monthBounds } from './profit-model.js';
import { createProfitPreview, verifyProfitPreview } from './profit-preview.js';
import { parseWorkbookXlsx } from './xlsx-parser.js';

const TARGET='ce9dd331-929d-4c3e-9073-368de3346bc9';
const JSON_LIMIT=1500000, FILE_LIMIT=6000000;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers});}
async function owner(request,env){
 if(!env.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB) return {error:'Service unavailable',status:503};
 const actor=await verifySession(request,env.OFFICE_SESSION_SECRET);
 if(!actor)return {error:'Unauthorized',status:401};
 const allowed=await env.OZON_FINANCE_DB.prepare(`SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1`).bind(actor,env.OFFICE_ALLOWED_EMAIL).first();
 return allowed?{actor}:{error:'Forbidden',status:403};
}
function service(env){const rpc=env.OZON_FINANCE_SYNC;if(!rpc||typeof rpc.getProfitData!=='function'||typeof rpc.getProfitDocument!=='function'||typeof rpc.confirmProfitDocument!=='function')throw new Error('profit_service_unavailable');return rpc;}
function target(data){if(data?.target!==TARGET)throw new Error('profit_target_mismatch');return data;}
async function boundedBody(request,limit){
 const declared=request.headers.get('Content-Length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw new Error('profit_payload_too_large');
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid_profit_body');
 const parts=[];let length=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error('profit_payload_too_large');}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
function failure(error){
 const code=error?.message||'';
 if(code==='profit_payload_too_large')return json({error:'Payload too large'},413);
 if(/preview|conflict|UNIQUE constraint/i.test(code))return json({error:'Preview expired, changed or already confirmed. Request a new preview.'},409);
 if(/target|service|database|no such table/i.test(code))return json({error:'Profit service unavailable; check test database migration and bindings.'},503);
 return json({error:'Invalid profit data. Check dates, sources, quantities and document fields.'},400);
}
export async function onRequestGet({request,env}){
 try{
  const access=await owner(request,env);if(access.error)return json({error:access.error},access.status);
  const month=new URL(request.url).searchParams.get('month')||new Date().toISOString().slice(0,7);monthBounds(month);
  const data=target(await service(env).getProfitData(month));
  const configuration=data.configuration;
  const result=calculateProfit({month,api:data.api,documents:configuration.month,costs:configuration.costs,expenses:configuration.expenses,tax:configuration.tax});
  return json({result,configuration,versions:data.versions,audit:data.audit,target:data.target});
 }catch(error){return failure(error);}
}
export async function onRequestPost({request,env}){
 try{
  const access=await owner(request,env);if(access.error)return json({error:access.error},access.status);
  if(request.headers.get('Origin')!==new URL(request.url).origin||(request.headers.has('Sec-Fetch-Site')&&request.headers.get('Sec-Fetch-Site')!=='same-origin'))return json({error:'Invalid origin'},403);
  const rpc=service(env), type=(request.headers.get('Content-Type')||'').toLowerCase();let body;
  if(type.startsWith('multipart/form-data')){
   const bytes=await boundedBody(request,FILE_LIMIT);
   const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();
   if(form.get('action')!=='preview')return json({error:'Import requires preview'},400);
   const month=form.get('month');monthBounds(month);const file=form.get('report');
   if(!file||typeof file.arrayBuffer!=='function'||!file.name?.toLowerCase().endsWith('.xlsx')||file.size<=0||file.size>FILE_LIMIT) return json({error:'XLSX report required'},400);
   const binary=await file.arrayBuffer();const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',binary)),b=>b.toString(16).padStart(2,'0')).join('');
   const workbook=await parseWorkbookXlsx(binary);
   body={action:'preview',key:`month:${month}`,value:normalizeProfitWorkbook(workbook,{month,sourceName:file.name.replace(/[\\/]/g,'_').slice(0,180),sourceSha256:sha})};
  }else if(type.startsWith('application/json')){
   body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(request,JSON_LIMIT)));
  }else return json({error:'JSON or XLSX multipart required'},415);
  if(!body||!['preview','confirm'].includes(body.action))return json({error:'Preview or confirm action required'},400);
  const value=validateProfitDocument(body.key,body.value);
  if(new TextEncoder().encode(JSON.stringify(value)).length>JSON_LIMIT)throw new Error('profit_payload_too_large');
  if(body.action==='preview'){
   const before=target(await rpc.getProfitDocument(body.key));
   return json(await createProfitPreview(env.OFFICE_SESSION_SECRET,access.actor,body.key,value,before));
  }
  const preview=await verifyProfitPreview(env.OFFICE_SESSION_SECRET,access.actor,body.key,value,body.token);
  const saved=target(await rpc.confirmProfitDocument({key:body.key,value,version:preview.version,actor:access.actor,changeId:preview.changeId}));
  return json(saved);
 }catch(error){return failure(error);}
}
