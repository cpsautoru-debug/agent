import {signBridgeRequest,validBridgeSecret} from './ms-production-bridge-auth.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateCatalogPage(data,offset,expected){
 if(data?.code!=='sales_directory_ok'||data.type!=='assortment'||data.readOnly!==true||
 data.changedRecords!==0||!Number.isSafeInteger(data.total)||data.total<0||data.total>10000||
 (expected!==null&&expected!==data.total)||!Array.isArray(data.items)||
 data.items.length!==Math.min(25,Math.max(0,data.total-offset))||offset>data.total)throw Error('catalog_page_unverified');
 const ids=new Set();
 for(const x of data.items){
  if(!UUID.test(x?.id||'')||ids.has(x.id.toLowerCase())||!['product','variant','bundle','service'].includes(x.itemType)||
 typeof x.name!=='string'||!x.name||x.name.length>250||typeof x.archived!=='boolean'||
 ![x.article,x.code,x.updated].every(v=>v===null||typeof v==='string'&&v.length<=250)||
 !Array.isArray(x.barcodes)||x.barcodes.some(v=>typeof v!=='string'||v.length>100)||
 !Array.isArray(x.characteristics))throw Error('catalog_item_unverified');
 ids.add(x.id.toLowerCase());
 }
 const next=offset+data.items.length;
 if(data.nextOffset!==(next===data.total?null:next))throw Error('catalog_cursor_unverified');
 return {next,complete:next===data.total};
}
export async function syncAssortmentPage({db,secret,fetcher=fetch,now=Date.now}){
 if(!db||!validBridgeSecret(secret))throw Error('catalog_configuration');
 let scan=await db.prepare("SELECT generation,next_offset,total FROM ms_assortment_scan WHERE status='loading'").first();
 if(!scan){
  const generation=crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO ms_assortment_scan(generation,started_at,status) VALUES (?,?,'loading')").bind(generation,new Date(now()).toISOString()).run();
  scan=await db.prepare("SELECT generation,next_offset,total FROM ms_assortment_scan WHERE status='loading'").first();
 }
 if(!scan)throw Error('catalog_scan_unavailable');
 const offset=scan.next_offset,path='/api/ms/sales-bridge?'+new URLSearchParams({type:'assortment',offset:String(offset)});
 const stamp=now();
 const response=await fetcher(ORIGIN+path,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'X-MS-Bridge-Time':String(stamp),'X-MS-Bridge-Signature':await signBridgeRequest(secret,stamp,path)}});
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('catalog_http_'+response.status);}
 const reader=response.body?.getReader();if(!reader)throw Error('catalog_body');
 let raw='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const {done,value}=await reader.read();if(done){raw+=decoder.decode();break;}bytes+=value.byteLength;if(bytes>131072)throw Error('catalog_payload');raw+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
 const data=JSON.parse(raw);
 let page;
 try{page=validateCatalogPage(data,offset,scan.total);}catch(e){
 await db.prepare("UPDATE ms_assortment_scan SET status='abandoned' WHERE generation=? AND next_offset=? AND status='loading'").bind(scan.generation,offset).run();throw e;
 }
 const statements=data.items.map(x=>db.prepare("INSERT INTO ms_assortment_items(generation,item_id,item_type,article,code,item_json) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ms_assortment_scan WHERE generation=? AND next_offset=? AND status='loading')").bind(scan.generation,x.id.toLowerCase(),x.itemType,x.article,x.code,JSON.stringify(x),scan.generation,offset));
 statements.push(db.prepare("UPDATE ms_assortment_scan SET next_offset=?,total=?,status=? WHERE generation=? AND next_offset=? AND status='loading'").bind(page.next,data.total,page.complete?'complete':'loading',scan.generation,offset));
 if(page.complete)statements.push(db.prepare("INSERT INTO ms_assortment_current(singleton,generation,completed_at,row_count) SELECT 1,generation,?,total FROM ms_assortment_scan WHERE generation=? AND status='complete' AND total=(SELECT count(*) FROM ms_assortment_items WHERE generation=?) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation,completed_at=excluded.completed_at,row_count=excluded.row_count WHERE ms_assortment_current.completed_at<excluded.completed_at").bind(new Date(now()).toISOString(),scan.generation,scan.generation));
 try{const results=await db.batch(statements);if(!Array.isArray(results)||results.some(x=>x.success!==true))throw Error('catalog_batch_unverified');if(results[data.items.length]?.meta?.changes!==1)throw Error('catalog_concurrent_scan');}catch(e){if(e.message!=='catalog_concurrent_scan')await db.prepare("UPDATE ms_assortment_scan SET status='abandoned' WHERE generation=? AND next_offset=? AND status='loading'").bind(scan.generation,offset).run();throw e;}
 return {generation:scan.generation,nextOffset:page.next,total:data.total,complete:page.complete};
}
