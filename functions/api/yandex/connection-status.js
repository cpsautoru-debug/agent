import {verifySession} from '../auth/session.js';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
 'Vary':'Cookie'};
const output=(code,payload)=>new Response(JSON.stringify(payload),
 {status:code,headers:HEADERS});
const AUTH_SQL="SELECT 1 AS allowed FROM office_authorized_users "+
 "WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
// Read-only API key check. Never echo token, token name, credentials, or raw response.
export async function onRequestGet({request,env}){
 if(request.method!=='GET')return output(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/yandex/connection-status'||url.search||url.hash)
  return output(400,{code:'invalid_scope'});
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB)return output(503,{code:'office_auth_not_configured'});
 let sub;
 try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
 catch{return output(401,{code:'unauthorized'});}
 if(!sub)return output(401,{code:'unauthorized'});
 try{
  const row=await env.OZON_FINANCE_DB.prepare(AUTH_SQL)
   .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
  if(row?.allowed!==1)return output(403,{code:'forbidden'});
 }catch{return output(503,{code:'office_auth_unavailable'});}
 const token=env.YANDEX_MARKET_API_KEY;
 if(typeof token!=='string'||token.length<12)
  return output(200,{code:'yandex_secret_missing',connected:false,
   tokenRequiredInCloudflare:'YANDEX_MARKET_API_KEY',
   financeAccess:false,financialPnlVerified:false});
 try{
  const response=await fetch('https://api.partner.market.yandex.ru/v2/auth/token',{
   method:'POST',headers:{'Api-Key':token,'Accept':'application/json'},
   signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return output(200,{code:'yandex_token_not_verified',
   connected:false,financeAccess:false,financialPnlVerified:false});
  const parsed=await response.json();
  const scopes=parsed?.result?.apiKey?.authScopes;
  if(parsed.status!=='OK'||!Array.isArray(scopes))
   return output(200,{code:'yandex_token_response_unverified',
    connected:false,financeAccess:false,financialPnlVerified:false});
  const readonly=scopes.includes('ALL_METHODS_READ_ONLY');
  const finance=readonly||scopes.includes('FINANCE_AND_ACCOUNTING')||
    scopes.includes('ALL_METHODS');
  const writeScope=scopes.includes('ALL_METHODS');
  return output(200,{code:finance?'yandex_finance_access_confirmed':
    'yandex_finance_access_missing',
   connected:true,financeAccess:finance,readOnlyToken:!writeScope,
   financialPnlVerified:false,
   status:'API key authenticated; finance source transactions not yet reconciled'});
 }catch{return output(200,{code:'yandex_api_unavailable',connected:false,
  financeAccess:false,financialPnlVerified:false});}
}
