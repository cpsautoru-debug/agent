import {verifySession} from '../auth/session.js';
import {createImportPreviewHandler} from './import-preview.js';
import {PILOT_REPORT_ID,digest,readSavedReport,saveReport} from '../../../workers/wb-saved-report.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Origin'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
async function authorize(request,env){
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)return {error:503};
 const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
 if(!sub)return {error:401};
 const owner=await env.OZON_FINANCE_DB.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
 if(owner?.allowed!==1)return {error:403};
 if(env.WB_REPORT_SAVE_MODE!=='test-only'||!env.WB_REPORT_SNAPSHOT_DB||env.WB_REPORT_SNAPSHOT_DB===env.OZON_FINANCE_DB||typeof env.WB_REPORT_ACCOUNT_ID!=='string'||!env.WB_REPORT_ACCOUNT_ID.trim())return {error:503};
 return {sub};
}
export function createSavedReportHandlers(dependencies={}){
 const preview=createImportPreviewHandler(dependencies);
 return {
 async onRequestGet({request,env}){
  try{
   const auth=await authorize(request,env);if(auth.error)return json(auth.error,{error:auth.error===401?'unauthorized':auth.error===403?'forbidden':'service_unavailable'});
   const id=new URL(request.url).searchParams.get('reportId');
   if(id!==PILOT_REPORT_ID)return json(400,{error:'pilot_report_only'});
   const stored=await readSavedReport(env.WB_REPORT_SNAPSHOT_DB,env.WB_REPORT_ACCOUNT_ID);
   return stored?json(200,{persisted:true,storage:'TEST_D1',snapshot:stored.snapshot}):json(404,{error:'saved_report_not_found'});
  }catch{return json(503,{error:'service_unavailable'})}
 },
 async onRequestPost({request,env}){
  try{
   const auth=await authorize(request,env);if(auth.error)return json(auth.error,{error:auth.error===401?'unauthorized':auth.error===403?'forbidden':'service_unavailable'});
   if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-WB-Save-Report')!=='1')return json(403,{error:'invalid_request_origin'});
   const copy=request.clone();
   // Reuse all existing owner/CSRF/body-size/XLSX/payout/cost checks. Never trust client totals.
   const checked=await preview({request,env});
   if(!checked.ok)return checked;
   const value=await checked.json();
   if(value.reportId!==PILOT_REPORT_ID)return json(400,{error:'pilot_report_only'});
   if(value.dataVerified!==false||value.profitStatus!=='UNVERIFIED'||value.source!=='XLSX_WITH_PRIVATE_SKU_CATALOG'||value.wbPayoutReconciliation!=='MATCHED_MANUAL_TARGET'||!value.breakdown.every(x=>x.costStatus==='CONFIRMED_BY_USER'))return json(422,{error:'confirmed_costs_required'});
   const form=await copy.formData();
   const fingerprint=await digest(JSON.stringify({rules:'wb-1044-v1',reportId:value.reportId,xlsx:await digest(await form.get('xlsx').arrayBuffer()),catalog:await digest(await form.get('catalog').arrayBuffer()),preview:value}));
   const saved=await saveReport(env.WB_REPORT_SNAPSHOT_DB,env.WB_REPORT_ACCOUNT_ID,value,fingerprint,auth.sub);
   if(saved.conflict)return json(409,{error:'saved_report_conflict'});
   return json(saved.duplicate?200:201,{persisted:true,storage:'TEST_D1',...saved});
  }catch{return json(503,{error:'service_unavailable'})}
 }
 };
}
const handlers=createSavedReportHandlers();
export const onRequestGet=handlers.onRequestGet;
export const onRequestPost=handlers.onRequestPost;
