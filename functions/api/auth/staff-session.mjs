import {STAFF_ROLES} from '../orders/staff-projection.mjs';
// Dedicated cookie and signing key: never interchangeable with the owner session.
const COOKIE='__Host-office_staff_session',TTL=28800;
const encode=b=>btoa(String.fromCharCode(...b)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const bytes=s=>new TextEncoder().encode(s);
async function key(secret){return crypto.subtle.importKey('raw',bytes('staff-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
const validSecret=env=>typeof env?.OFFICE_STAFF_SESSION_SECRET==='string'&&env.OFFICE_STAFF_SESSION_SECRET.length>=32&&env.OFFICE_STAFF_SESSION_SECRET!==env.OFFICE_SESSION_SECRET;
export async function createStaffSession(identity,env,now=Date.now()){
 if(!validSecret(env)||typeof identity?.sub!=='string'||!identity.sub||!Number.isSafeInteger(identity.revision)||identity.revision<1)throw Error('staff_session_unavailable');
 const iat=Math.floor(now/1000),payload=encode(bytes(JSON.stringify({aud:'office_staff',sub:identity.sub,revision:identity.revision,iat,exp:iat+TTL})));
 const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(env.OFFICE_STAFF_SESSION_SECRET),bytes(payload))));
 return COOKIE+'='+payload+'.'+signature+'; Path=/; Max-Age='+TTL+'; HttpOnly; Secure; SameSite=Lax';
}
export async function authorizeStaff(request,env,now=Date.now()){
 if(!validSecret(env)||!env.OZON_FINANCE_DB)return {status:503,code:'staff_auth_unavailable'};
 try{
 const matches=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
 if(matches.length!==1)return {status:401,code:'staff_session_required'};
 const parts=matches[0].slice(COOKIE.length+1).split('.');
 if(parts.length!==2||parts.some(p=>!p||p.length>4096))return {status:401,code:'staff_session_required'};
 const [payload,signature]=parts;
 if(!await crypto.subtle.verify('HMAC',await key(env.OFFICE_STAFF_SESSION_SECRET),decode(signature),bytes(payload)))return {status:401,code:'staff_session_required'};
 const t=JSON.parse(new TextDecoder().decode(decode(payload))),clock=Math.floor(now/1000);
 if(t.aud!=='office_staff'||typeof t.sub!=='string'||!t.sub||!Number.isSafeInteger(t.revision)||!Number.isSafeInteger(t.iat)||!Number.isSafeInteger(t.exp)||t.exp-t.iat!==TTL||t.iat>clock||t.exp<=clock)return {status:401,code:'staff_session_required'};
 const row=await env.OZON_FINANCE_DB.prepare('SELECT role,enabled,revision FROM office_staff_access WHERE google_sub=? LIMIT 1').bind(t.sub).first();
 if(row?.enabled!==1||row.revision!==t.revision||!STAFF_ROLES.includes(row.role))return {status:403,code:'staff_access_denied'};
 return {status:200,sub:t.sub,role:row.role};
 }catch{return {status:503,code:'staff_auth_unavailable'};}
}
