// Stores only Yandex-generated report IDs, not API credentials or financial rows.
// Owner authorization is still enforced on every server request.
const KEY='autosklad63.yandex.report-jobs.v1';
const PENDING_TTL=72*60*60*1000;
const VERIFIED_TTL=45*24*60*60*1000;
const NO_DATA_TTL=7*24*60*60*1000;
const ttlFor=job=>job?.noData===true?NO_DATA_TTL:
 job?.audited===true&&job?.status==='DONE'?VERIFIED_TTL:PENDING_TTL;
const ids=/^[a-zA-Z0-9_-]{1,255}$/;
const jobKey=/^20\d{2}-(0[1-9]|1[0-2]):(?:all|\d{1,15}):(orders|services|payments|realization)$/;
export function restoreYandexReportJobs(store,now=Date.now()){
 const restored=new Map();
 try{
  const raw=JSON.parse(store?.getItem(KEY)||'{}');
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return restored;
  for(const [key,v]of Object.entries(raw)){
   if(!jobKey.test(key)||!v||!ids.test(v.reportId||'')||
      !Number.isSafeInteger(v.createdAt)||
      v.createdAt>now||now-v.createdAt>ttlFor(v)||
      !['PENDING','PROCESSING','DONE','FAILED'].includes(v.status))continue;
   restored.set(key,{reportId:v.reportId,status:v.status,
    createdAt:v.createdAt,audited:v.audited===true,
    noData:v.noData===true&&v.audited===true,
    subStatus:['NO_DATA','TOO_LARGE','RESOURCE_NOT_FOUND','UNKNOWN']
     .includes(v.subStatus)?v.subStatus:null});
  }
 }catch{return restored;}
 return restored;
}
export function saveYandexReportJobs(store,jobs,now=Date.now()){
 if(!store||!(jobs instanceof Map))return false;
 const entries={};
 for(const [key,v]of jobs){
  if(!jobKey.test(key)||!ids.test(v?.reportId||'')||
     !Number.isSafeInteger(v.createdAt)||v.createdAt>now||
     now-v.createdAt>ttlFor(v))continue;
  entries[key]={reportId:v.reportId,status:v.status,
   createdAt:v.createdAt,audited:v.audited===true,
   noData:v.noData===true&&v.audited===true,
   subStatus:['NO_DATA','TOO_LARGE','RESOURCE_NOT_FOUND','UNKNOWN']
    .includes(v.subStatus)?v.subStatus:null};
 }
 try{store.setItem(KEY,JSON.stringify(entries));return true;}
 catch{return false;}
}

/** Merge server report IDs conservatively; never overwrite an audited
 * same-generation local job. A newer ID must be re-audited first. */
export function mergeYandexRemoteJobs(local,remote,now=Date.now()){
 if(!(local instanceof Map)||!Array.isArray(remote))return local;
 const merged=new Map(local);
 for(const job of remote.slice(0,20)){
  if(!job||typeof job!=='object')continue;
  const k=job.month+':'+job.scope+':'+job.reportType;
  if(!jobKey.test(k)||!ids.test(job.reportId||'')||
     !Number.isSafeInteger(job.createdAt)||job.createdAt>now||
     now-job.createdAt>VERIFIED_TTL||
     !['PENDING','PROCESSING','DONE','FAILED'].includes(job.status))
   continue;
  const before=merged.get(k);
  if(before&&before.createdAt>job.createdAt)continue;
  if(before&&before.reportId===job.reportId&&
     before.createdAt===job.createdAt){
   // Keep the local audit flag; server only stores job metadata.
   if(before.status!=='DONE'&&job.status==='DONE')
    merged.set(k,{...before,status:'DONE'});
   continue;
  }
  merged.set(k,{reportId:job.reportId,status:job.status,
   createdAt:job.createdAt,audited:false,noData:false,subStatus:null});
 }
 return merged;
}
