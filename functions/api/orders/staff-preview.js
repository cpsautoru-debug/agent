import {createPersistentQueue} from './persistent-queue.js';
import {staffProjection,STAFF_ROLES} from './staff-projection.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
// Owner-only preview; the existing queue handler performs server-side owner authorization.
export function createStaffPreview({queue=createPersistentQueue()}={}){
 return async({request,env})=>{
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  const u=new URL(request.url),role=u.searchParams.get('role');
  if(u.origin!==ORIGIN||u.pathname!=='/api/orders/staff-preview'||u.hash||[...u.searchParams.keys()].join(',')!=='role'||!STAFF_ROLES.includes(role))return reply(400,{code:'invalid_scope'});
  try{
   const internal=new Request(ORIGIN+'/api/orders/persistent-queue',{headers:{Cookie:request.headers.get('Cookie')||'',Accept:'application/json'}});
   const r=await queue({request:internal,env});
   if(!r.ok)return reply([401,403].includes(r.status)?r.status:503,{code:'owner_preview_unavailable'});
   const data=await r.json();
   if(data.code!=='persistent_queue_read'||data.readOnly!==true||!Array.isArray(data.orders))return reply(503,{code:'owner_preview_unavailable'});
   return reply(200,{code:'staff_preview',ownerPreview:true,...staffProjection(role,data)});
  }catch{return reply(503,{code:'owner_preview_unavailable'});}
 };
}
export const onRequest=createStaffPreview();
