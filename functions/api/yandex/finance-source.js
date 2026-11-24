import {verifySession} from '../auth/session.js';
const AUTH="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
export const headers={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie',
 'X-Content-Type-Options':'nosniff'};
export const json=(status,payload)=>new Response(JSON.stringify(payload),{status,headers});
export async function verifyYandexOwner(request,env){
 if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
   !env.OZON_FINANCE_DB||typeof env.YANDEX_MARKET_API_KEY!=='string'||
   env.YANDEX_MARKET_API_KEY.length<12)return {code:'not_configured',status:503};
 let sub;
 try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
 catch{return {code:'unauthorized',status:401};}
 if(!sub)return {code:'unauthorized',status:401};
 try{
  const owner=await env.OZON_FINANCE_DB.prepare(AUTH)
   .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
  if(owner?.allowed!==1)return {code:'forbidden',status:403};
 }catch{return {code:'authorization_unavailable',status:503};}
 return null;
}
export async function yandexRequest(env,path,{method='GET',body}={}){
 if(!/^\/v2\/(?:campaigns(?:\?.*)?|reports\/(?:united-orders|united-marketplace-services|united-netting|goods-realization)\/generate\?format=JSON|reports\/info\/[a-zA-Z0-9_-]{1,255})$/.test(path))
  throw Error('yandex_path_not_allowed');
 const response=await fetch('https://api.partner.market.yandex.ru'+path,{
  method,headers:{'Api-Key':env.YANDEX_MARKET_API_KEY,'Accept':'application/json',
   ...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(12500)
 });
 if(!response.ok){
  if(response.status===401||response.status===403)throw Error('yandex_access_denied');
  if(response.status===420||response.status===429)throw Error('yandex_rate_limited');
  throw Error('yandex_upstream_failed');
 }
 const data=await response.json();
 if(data.status==='ERROR'||data.status!=='OK'&&path.includes('/reports/'))
  throw Error('yandex_api_response_invalid');
 return data;
}
export async function listYandexCampaigns(env){
 const campaigns=[],seenTokens=new Set();
 let next='';
 for(let i=0;i<8;i++){
  const path='/v2/campaigns?limit=100'+(next?'&pageToken='+encodeURIComponent(next):'');
  const data=await yandexRequest(env,path);
  if(!Array.isArray(data.campaigns))throw Error('yandex_campaigns_invalid');
  for(const campaign of data.campaigns){
   const id=campaign.id,business=campaign.business;
   if(!Number.isSafeInteger(id)||id<1||
     !Number.isSafeInteger(business?.id)||business.id<1||
     typeof business.name!=='string'||business.name.length>200)
    throw Error('yandex_campaign_identity_invalid');
   if(campaign.apiAvailability==='AVAILABLE')
    campaigns.push({campaignId:id,businessId:business.id,
     businessName:business.name,shopName:String(campaign.domain||'').slice(0,200),
     placementType:campaign.placementType||'unknown'});
  }
  const token=data.paging?.nextPageToken;
  if(!token)return campaigns;
  if(typeof token!=='string'||token.length>500||seenTokens.has(token))
   throw Error('yandex_paging_invalid');
  seenTokens.add(token);next=token;
 }
 throw Error('yandex_campaign_pages_incomplete');
}
export function selectedBusiness(campaigns){
 if(!Array.isArray(campaigns)||!campaigns.length)throw Error('yandex_no_active_campaigns');
 const businesses=new Set(campaigns.map(x=>x.businessId));
 if(businesses.size!==1)throw Error('yandex_multiple_businesses_require_selection');
 return {businessId:[...businesses][0],campaignIds:
   [...new Set(campaigns.map(x=>x.campaignId))].sort((a,b)=>a-b)};
}
export function monthBounds(month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))
  throw Error('yandex_invalid_month');
 const start=month+'-01';
 const next=new Date(start+'T00:00:00Z');
 next.setUTCMonth(next.getUTCMonth()+1);
 return {dateFrom:start,dateTo:new Date(next.getTime()-86400000).toISOString().slice(0,10)};
}
export const reportPaths={
 orders:'united-orders',
 services:'united-marketplace-services',
 payments:'united-netting',
 realization:'goods-realization'
};
export function mapSafeYandexError(error){
 return new Set(['yandex_access_denied','yandex_rate_limited',
  'yandex_upstream_failed','yandex_api_response_invalid',
  'yandex_campaigns_invalid','yandex_campaign_identity_invalid',
  'yandex_paging_invalid','yandex_campaign_pages_incomplete',
  'yandex_no_active_campaigns','yandex_multiple_businesses_require_selection',
  'yandex_invalid_month','yandex_report_response_invalid',
  'yandex_report_not_found']).has(error?.message)?
   error.message:'yandex_source_unavailable';
}
