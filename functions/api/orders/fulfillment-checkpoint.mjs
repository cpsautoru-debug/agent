const MAX_PAGE_BYTES=90000;
const SCALAR=['id','updated','applicable','awaiting','productionEnd','deliveryPlannedMoment',
 'quantity','shipped','reserve','planQuantity','productionVolume','orderingPosition',
 'totalQuantity','completedQuantity'];
const REFS=['store','assortment','productsStore','productionTask','productionRow','processingPlan'];

function reference(value){
 const href=value?.meta?.href;
 if(typeof href!=='string')return null;
 try{
  const url=new URL(href);
  if(url.origin!=='https://api.moysklad.ru'||url.username||url.password||
     !/^\/api\/remap\/1\.2\/entity\/[A-Za-z0-9/\-]+$/.test(url.pathname))return null;
  return {meta:{href:url.origin+url.pathname}};
 }catch{return null;}
}

export function projectPage(data){
 if(!Array.isArray(data?.rows)||!Number.isSafeInteger(data.meta?.size))throw Error('invalid_scan_page');
 const {size,offset,nextHref}=data.meta;
 const meta={size};
 if(Number.isSafeInteger(offset))meta.offset=offset;
 if(nextHref)meta.nextHref=true;
 const rows=data.rows.map(row=>{
  const out={};
  for(const key of SCALAR){
   const value=row?.[key];
   if(typeof value==='boolean'||typeof value==='number'||
     (typeof value==='string'&&value.length<=50&&/^[0-9A-Za-z:.+ -]+$/.test(value)))
    out[key]=value;
  }
  for(const key of REFS)if(row?.[key])out[key]=reference(row[key]);
  if(row?.state)out.state={stateType:['Regular','Successful','Unsuccessful'].includes(row.state.stateType)
   ?row.state.stateType:null};
  if(Array.isArray(row?.customerOrders))out.customerOrders=row.customerOrders.map(reference);
  return out;
 });
 return {meta,rows};
}

export function checkpointReader(cache,save,read,budget){
 let calls=0,lastRead=0;
 return async path=>{
  if(cache.has(path))return cache.get(path);
  if(calls>=budget)throw Error('checkpoint_pending');
  calls++;
  // Keep requests sequential and leave space between uncached pages.
  const wait=180-(Date.now()-lastRead);
  if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
  lastRead=Date.now();
  const page=projectPage(await read(path));
  await save(path,page);
  cache.set(path,page);
  return page;
 };
}

export async function resumeScan(db,scope,read,scan,budget=6){
 const now=Date.now();
 const finishedKey='!complete';
 const finished=await db.prepare(`SELECT p.result_json
  FROM office_fulfillment_scan s JOIN office_fulfillment_scan_page p
   ON p.scope=s.scope AND p.generation=s.generation AND p.request_key=?
  WHERE s.scope=? AND s.expires_at>?`).bind(finishedKey,scope,now).first();
 if(finished)return JSON.parse(finished.result_json);
 const lease=crypto.randomUUID();
 const generation=crypto.randomUUID();
 const started=await db.prepare(`INSERT INTO office_fulfillment_scan
  (scope,generation,expires_at,lease_id,lease_until) VALUES(?,?,?,?,?)
  ON CONFLICT(scope) DO UPDATE SET
   generation=CASE WHEN expires_at<=? THEN excluded.generation ELSE generation END,
   expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END,
   lease_id=excluded.lease_id,lease_until=excluded.lease_until
  WHERE lease_until<=?
  RETURNING generation,expires_at`)
  .bind(scope,generation,now+20*60000,lease,now+60000,now,now,now).first();
 if(!started)return {progress:{state:'busy'}};
 try{
  if(started.generation===generation)
   await db.prepare('DELETE FROM office_fulfillment_scan_page WHERE scope=? AND generation<>?')
    .bind(scope,started.generation).run();
  const cached=await db.prepare(`SELECT request_key,result_json FROM office_fulfillment_scan_page
   WHERE scope=? AND generation=?`).bind(scope,started.generation).all();
  const cache=new Map(cached.results.map(row=>[row.request_key,JSON.parse(row.result_json)]));
  if(cache.has(finishedKey))return cache.get(finishedKey);
  const save=async(path,page)=>{
   const json=JSON.stringify(page);
   if(json.length>MAX_PAGE_BYTES)throw Error('checkpoint_page_too_large');
   const result=await db.prepare(`INSERT INTO office_fulfillment_scan_page
    (scope,generation,request_key,result_json)
    SELECT scope,generation,?,? FROM office_fulfillment_scan
     WHERE scope=? AND generation=? AND lease_id=? AND lease_until>?
    ON CONFLICT DO NOTHING`).bind(path,json,scope,started.generation,lease,Date.now()).run();
   if(result.meta?.changes!==1)throw Error('checkpoint_lease_lost');
  };
  const evidence=await scan(checkpointReader(cache,save,read,budget));
  const summary={...evidence,progress:{state:'checkpointed',pages:cache.size,
   expiresAt:new Date(started.expires_at).toISOString()}};
  if(['warehouse_orders_verified','production_verified'].includes(evidence.status)&&
     JSON.stringify(summary).length<=MAX_PAGE_BYTES)await save(finishedKey,summary);
  return summary;
 }finally{
  await db.prepare('UPDATE office_fulfillment_scan SET lease_id=NULL,lease_until=0 WHERE scope=? AND lease_id=?')
   .bind(scope,lease).run();
 }
}
