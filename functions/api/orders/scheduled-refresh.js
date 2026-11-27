import {validBridgeSecret,verifyBridgeRequest} from '../../../workers/ms-production-bridge-auth.js';
import {createMarketplaceOrderPreview} from '../marketplace/order-import-preview.js';
import {createYandexOrdersPreview} from '../yandex/orders-preview.js';
import {createManualOrdersPreview} from '../ms/manual-orders-preview.js';
import {saveSourceSnapshot} from './persistent-queue.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev',PATH='/api/orders/scheduled-refresh';
const SOURCES=['ozon','ozon_fbo','wb','yandex','manual'];
const reply=(status,data)=>new Response(JSON.stringify({changedMoySkladRecords:0,...data}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
export function createScheduledRefresh({now=Date.now,fetcher=fetch,makeMarketplace=createMarketplaceOrderPreview,makeYandex=createYandexOrdersPreview,makeManual=createManualOrdersPreview,save=saveSourceSnapshot}={}){
 return async({request,env})=>{
  if(request.method!=='POST')return reply(405,{code:'method_not_allowed'});
  const u=new URL(request.url),source=u.searchParams.get('source');
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.hash||[...u.searchParams.keys()].join(',')!=='source'||!SOURCES.includes(source))return reply(400,{code:'invalid_scope'});
  if(!validBridgeSecret(env?.MS_SALES_BRIDGE_SECRET)||!env.OZON_FINANCE_DB)return reply(503,{code:'scheduled_refresh_not_configured'});
  let verified=false;
  try{verified=await verifyBridgeRequest(env.MS_SALES_BRIDGE_SECRET,request.headers.get('X-MS-Bridge-Time'),request.headers.get('X-MS-Bridge-Signature'),u.pathname+u.search,now());}catch{}
  if(!verified)return reply(401,{code:'unauthorized'});
  if(env.MS_ORDER_AUTO_SYNC!=='enabled')return reply(503,{code:'scheduled_refresh_disabled'});
  const db=env.OZON_FINANCE_DB;
  try{
   const last=await db.prepare('SELECT last_success_at FROM office_order_queue_sync WHERE source=?').bind(source).first();
   const age=now()-Date.parse(last?.last_success_at);
   if(age>=0&&age<300000)return reply(200,{code:'scheduled_refresh_reused',source});
   const path=source==='manual'?'/api/ms/manual-orders-preview':source==='yandex'?'/api/yandex/orders-preview':'/api/marketplace/order-import-preview?source='+source;
   const internal=new Request(ORIGIN+path);
   const options={fetcher,now,authorizeServer:async candidate=>candidate===internal};
   const handler=source==='manual'?makeManual(options):source==='yandex'?makeYandex(options):makeMarketplace(options);
   const response=await handler({request:internal,env});
   if(response.status!==200){
    let reason='source_error';try{const data=await response.json();if(['token_rejected','permission_denied','rate_limited','unexpected_order_feed','unmapped_order_line','order_pagination_unverified','order_feed_limit_reached','order_page_limit_reached','upstream_response_too_large','import_preview_unavailable','marketplace_credentials_missing','moysklad_credentials_missing'].includes(data.code))reason=data.code;}catch{}
    console.warn('scheduled_order_source_failed',source,reason,response.status);
    return reply(503,{code:'scheduled_source_unverified',source,reason,upstreamStatus:response.status});
   }
   const upstream=await response.json();
   const saved=await save(db,source,upstream,now);
   if(saved.ok)return saved;
   let reason='snapshot_save_failed';
   try{const data=await saved.json();if(['snapshot_incomplete_or_too_large','snapshot_unverified','persistent_queue_storage_unavailable'].includes(data.code))reason=data.code;}catch{}
   return reply(503,{code:'scheduled_save_failed',source,reason});
  }catch{return reply(503,{code:'scheduled_refresh_failed',source,reason:'scheduled_refresh_failed'});}
 };
}
export const onRequest=createScheduledRefresh();
