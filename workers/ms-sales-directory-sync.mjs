import {syncAssortmentPage} from './ms-assortment-sync.mjs';
import {signBridgeRequest,validBridgeSecret} from './ms-production-bridge-auth.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const TYPES=['counterparty','saleschannel','organization','store'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function syncDirectoryType({db,secret,type,fetcher=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!db||!validBridgeSecret(secret)||!TYPES.includes(type))throw Error('sales_sync_configuration');
 let offset=0,total=null;const items=[],ids=new Set();
 for(let page=0;page<8;page++){
  if(page)await sleep(2000);
  const path='/api/ms/sales-bridge?'+new URLSearchParams({type,offset:String(offset)});
  const stamp=now();
  const response=await fetcher(ORIGIN+path,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,path)}});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('sales_sync_http_'+response.status);}
  const reader=response.body?.getReader();if(!reader)throw Error('sales_sync_body');
  let raw='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const {done,value}=await reader.read();if(done){raw+=decoder.decode();break;}bytes+=value.byteLength;if(bytes>131072)throw Error('sales_sync_payload');raw+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
  const data=JSON.parse(raw);
  if(data.code!=='sales_directory_ok'||data.type!==type||data.readOnly!==true||!Number.isSafeInteger(data.total)||data.total<0||(total!==null&&total!==data.total)||!Array.isArray(data.items)||data.items.length!==Math.min(25,Math.max(0,data.total-offset)))throw Error('sales_sync_page_unverified');
  total=data.total;
  for(const item of data.items){
   if(!UUID.test(item?.id||'')||ids.has(item.id.toLowerCase())||typeof item.name!=='string'||item.name.length>250||typeof item.archived!=='boolean')throw Error('sales_sync_item_unverified');
   ids.add(item.id.toLowerCase());items.push({id:item.id,name:item.name,archived:item.archived});
  }
  offset+=data.items.length;
  if(offset===total){
   if(data.nextOffset!==null)throw Error('sales_sync_cursor_unverified');
   const fetchedAt=new Date(now()).toISOString();
   await db.prepare('INSERT INTO ms_sales_directory_snapshots (entity_type,fetched_at,row_count,items_json) VALUES (?,?,?,?) ON CONFLICT(entity_type) DO UPDATE SET fetched_at=excluded.fetched_at,row_count=excluded.row_count,items_json=excluded.items_json WHERE excluded.fetched_at>=ms_sales_directory_snapshots.fetched_at').bind(type,fetchedAt,items.length,JSON.stringify(items)).run();
   return {type,count:items.length,fetchedAt};
  }
  if(data.nextOffset!==offset)throw Error('sales_sync_cursor_unverified');
 }
 throw Error('sales_sync_page_cap');
}
const SOURCES=['ozon','ozon_fbo','wb','yandex','manual'];
export function orderRotation(slot){return {source:SOURCES[((slot%5)+5)%5],directory:slot%3===1?TYPES[((Math.floor(slot/3)%4)+4)%4]:null};}
export async function refreshOrderSource({secret,source,fetcher=fetch,now=Date.now}){
 if(!validBridgeSecret(secret)||!SOURCES.includes(source))throw Error('order_sync_configuration');
 const path='/api/orders/scheduled-refresh?'+new URLSearchParams({source});
 const stamp=now();
 const response=await fetcher(ORIGIN+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,path)}});
 if(!response.ok){let reason='unknown';try{const data=await response.json();if(typeof data.reason==='string'&&/^[a-z_]{1,80}$/.test(data.reason))reason=data.reason;}catch{}throw Error('order_sync_'+source+'_'+response.status+'_'+reason);}
 const reader=response.body?.getReader();if(!reader)throw Error('order_sync_body');
 let raw='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const {done,value}=await reader.read();if(done){raw+=decoder.decode();break;}bytes+=value.byteLength;if(bytes>8192)throw Error('order_sync_payload');raw+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
 const data=JSON.parse(raw);
 if(data.source!==source||data.changedMoySkladRecords!==0||!['persistent_queue_source_saved','scheduled_refresh_reused'].includes(data.code))throw Error('order_sync_unverified');
 return {source,code:data.code};
}
export async function resumeFulfillment({secret,fetcher=fetch,now=Date.now}){
 if(!validBridgeSecret(secret))throw Error('fulfillment_sync_configuration');
 const path='/api/orders/scheduled-fulfillment',stamp=now();
 const res=await fetcher(ORIGIN+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,path)}});
 if(!res.ok){await res.body?.cancel().catch(()=>{});throw Error('fulfillment_sync_http_'+res.status);}
 const data=await res.json();
 if(data.changedMoySkladRecords!==0||!['scheduled_fulfillment_idle','scheduled_fulfillment_checked'].includes(data.code))throw Error('fulfillment_sync_unverified');
 return data.code;
}
// No public fetch route. No writes to MoySklad. Disabled until explicitly configured.
export default {async scheduled(event,env){
 if(env.MS_SALES_DIRECTORY_SYNC!=='enabled')return;
 const minute=Math.floor(event.scheduledTime/60000);
 const slot=Math.floor(minute/5);
 // Opt-in catalogue read, independent of existing nine-slot rotation.
 // At most one additional page per 15 minutes; errors never block order sync.
 if(env.MS_ASSORTMENT_SYNC==='enabled'&&slot%3===0){
  try{await syncAssortmentPage({db:env.MS_PRODUCTION_DB,secret:env.MS_SALES_BRIDGE_SECRET});}
  catch(error){console.warn('assortment_sync_failed',String(error?.message||'unknown').slice(0,100));}
 }
 // One existing rotation operation per tick, plus the opt-in catalogue page above.
 // Orders rotate every 25 minutes; directories every 60 minutes. Keep legacy directory-only mode by default.
 if(env.MS_ORDER_AUTO_SYNC==='enabled'){
  const rotation=orderRotation(slot);
  try{await refreshOrderSource({secret:env.MS_SALES_BRIDGE_SECRET,source:rotation.source});}
  catch(error){const message=String(error?.message||'');console.warn('order_sync_failed',rotation.source,/^order_sync_[a-z0-9_]{1,110}$/.test(message)?message:'order_sync_transport_or_runtime_failure');throw error;}
  finally{
   if(rotation.directory)await syncDirectoryType({db:env.MS_PRODUCTION_DB,secret:env.MS_SALES_BRIDGE_SECRET,type:rotation.directory});
  }
  if(env.MS_FULFILLMENT_AUTO_SCAN==='enabled'){
   try{await resumeFulfillment({secret:env.MS_SALES_BRIDGE_SECRET});}
   catch{console.warn('scheduled_fulfillment_failed');}
  }
  return;
 }
 const hour=Math.floor(event.scheduledTime/3600000);
 const type=TYPES[((hour%4)+4)%4];
 await syncDirectoryType({db:env.MS_PRODUCTION_DB,secret:env.MS_SALES_BRIDGE_SECRET,type});
}};
