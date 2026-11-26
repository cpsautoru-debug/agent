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
// No public fetch route. No writes to MoySklad. Disabled until explicitly configured.
export default {async scheduled(event,env){
 if(env.MS_SALES_DIRECTORY_SYNC!=='enabled')return;
 const hour=Math.floor(event.scheduledTime/3600000);
 const type=TYPES[((hour%4)+4)%4];
 await syncDirectoryType({db:env.MS_PRODUCTION_DB,secret:env.MS_SALES_BRIDGE_SECRET,type});
}};
