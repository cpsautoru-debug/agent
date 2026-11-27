import {verifySession} from '../auth/session.js';
import {auditOzonUnfulfilled} from '../marketplace/ozon-unfulfilled-audit.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/orders/ozon-open-audit';
const reply=(status,data)=>new Response(JSON.stringify({readOnly:true,allOpenVerified:false,...data}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
export function createOzonOpenAudit({audit=auditOzonUnfulfilled,verify=verifySession,now=Date.now}={}){
 return async({request,env})=>{
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  const u=new URL(request.url);
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.search||u.hash)return reply(400,{code:'invalid_scope'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)return reply(503,{code:'owner_auth_unavailable'});
  let sub;
  try{sub=await verify(request,env.OFFICE_SESSION_SECRET);}catch{}
  if(!sub)return reply(401,{code:'owner_session_required'});
  const db=env.OZON_FINANCE_DB;
  try{
   const owner=await db.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return reply(403,{code:'owner_only'});
  }catch{return reply(503,{code:'owner_auth_unavailable'});}
  if(String(env.OZON_CLIENT_ID)!=='171189'||typeof env.OZON_API_KEY!=='string'||!env.OZON_API_KEY)return reply(503,{code:'audit_configuration'});
  try{
   const sync=await db.prepare("SELECT last_success_at,coverage,rows_seen FROM office_order_queue_sync WHERE source='ozon'").first();
   const age=now()-Date.parse(sync?.last_success_at||'');
   if(!(age>=0&&age<=1800000)||sync.coverage!=='FBS_PACKAGING_AND_AWAITING_DELIVER_LAST_30_DAYS_COMPLETE')return reply(409,{code:'baseline_unverified'});
   const {results}=await db.prepare("SELECT external_id AS posting_number,source_status AS status FROM office_order_queue WHERE source='ozon' AND account='171189' AND source_checked_at=? LIMIT 151").bind(sync.last_success_at).all();
   if(!Array.isArray(results)||results.length>150||results.length!==sync.rows_seen||results.some(r=>!r.posting_number||!['awaiting_packaging','awaiting_deliver'].includes(r.status)))return reply(409,{code:'baseline_unverified'});
   const result=await audit({account:'171189',token:env.OZON_API_KEY,now:now(),baseline:results});
   return reply(200,{code:'bounded_audit_complete',baselineCheckedAt:sync.last_success_at,baselineCount:results.length,scope:result.scope,pages:result.pages,received:result.received,onlyUnfulfilled:result.onlyUnfulfilled,onlyBaseline:result.onlyBaseline,statusMismatch:result.statusMismatch});
  }catch{return reply(503,{code:'bounded_audit_unavailable'});}
 };
}
export const onRequest=createOzonOpenAudit();
