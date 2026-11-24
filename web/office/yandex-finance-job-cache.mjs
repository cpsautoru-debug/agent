// Stores only Yandex-generated report IDs, not API credentials or financial rows.
// Owner authorization is still enforced on every server request.
const KEY='autosklad63.yandex.report-jobs.v1';
const TTL=72*60*60*1000;
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
      v.createdAt>now||now-v.createdAt>TTL||
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
     now-v.createdAt>TTL)continue;
  entries[key]={reportId:v.reportId,status:v.status,
   createdAt:v.createdAt,audited:v.audited===true,
   noData:v.noData===true&&v.audited===true,
   subStatus:['NO_DATA','TOO_LARGE','RESOURCE_NOT_FOUND','UNKNOWN']
    .includes(v.subStatus)?v.subStatus:null};
 }
 try{store.setItem(KEY,JSON.stringify(entries));return true;}
 catch{return false;}
}
