import {json,verifyYandexOwner,yandexRequest,mapSafeYandexError}
 from './finance-source.js';
import {parseYandexZip,describeYandexReportSheets}
 from '../../../web/office/yandex-report-archive.mjs';
const idRule=/^[a-zA-Z0-9_-]{1,255}$/;
function isOfficialDownload(raw){
 try{
  const url=new URL(raw);
  const host=url.hostname.toLowerCase();
  return url.protocol==='https:'&&!url.username&&!url.password&&
   ['yandex.ru','yandex.net','yandexcloud.net','yandex.com']
    .some(root=>host===root||host.endsWith('.'+root));
 }catch{return false;}
}
async function loadOfficialArchive(raw){
 if(!isOfficialDownload(raw))throw Error('yandex_file_host_not_allowed');
 let url=raw;
 for(let redirect=0;redirect<3;redirect++){
  const response=await fetch(url,{
   method:'GET',redirect:'manual',signal:AbortSignal.timeout(20000),
   headers:{Accept:'application/zip,application/octet-stream'}
  });
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('Location');
   const next=location?new URL(location,url).href:null;
   if(!next||!isOfficialDownload(next))
    throw Error('yandex_file_redirect_not_allowed');
   url=next;continue;
  }
  if(!response.ok)throw Error('yandex_file_unavailable');
  const max=12*1024*1024;
  const size=Number(response.headers.get('content-length'));
  if(Number.isFinite(size)&&size>max)
   throw Error('yandex_file_too_large');
  const reader=response.body?.getReader();
  if(!reader)throw Error('yandex_file_empty');
  const chunks=[];let length=0;
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   length+=value.length;
   if(length>max){await reader.cancel();throw Error('yandex_file_too_large');}
   chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes.buffer;
 }
 throw Error('yandex_file_redirect_limit');
}
export async function onRequestGet({request,env}){
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/yandex/report-audit'||url.searchParams.size!==1||
   !idRule.test(url.searchParams.get('reportId')||''))
  return json(400,{code:'invalid_report_id'});
 const issue=await verifyYandexOwner(request,env);
 if(issue)return json(issue.status,{code:issue.code});
 try{
  const response=await yandexRequest(env,
   '/v2/reports/info/'+url.searchParams.get('reportId'));
  const report=response.result;
  const status=['PENDING','PROCESSING','FAILED','DONE'].includes(
   report?.status)?report.status:'UNKNOWN';
  const subStatus=['NO_DATA','TOO_LARGE','RESOURCE_NOT_FOUND'].includes(
   report?.subStatus)?report.subStatus:null;
  // Yandex may finish an empty realization report without any ZIP link.
  // NO_DATA is an explicit upstream status, not evidence of 0 sold units.
  if(['FAILED','DONE'].includes(status)&&subStatus==='NO_DATA'&&
     typeof report?.file!=='string')
   return json(200,{code:'yandex_report_no_data',readOnly:true,
    changedRecords:0,sourceStatus:status,subStatus,
    dataAvailable:false,fileDownloaded:false,financeProfitVerified:false});
  if(status!=='DONE'||typeof report?.file!=='string')
   return json(200,{code:'report_not_ready',status,subStatus,
    fileAvailable:false,financeProfitVerified:false});
  const archive=await loadOfficialArchive(report.file);
  const files=await parseYandexZip(archive);
  const result=describeYandexReportSheets(files);
  return json(200,{code:'yandex_report_archive_audited',
   readOnly:true,changedRecords:0,
   sheets:result.sheets,financeProfitKopecks:null,
   financeProfitVerified:false,note:result.note,
   fileDownloaded:true,archiveBytes:archive.byteLength});
 }catch(e){
  const allowed=['yandex_file_host_not_allowed','yandex_file_redirect_not_allowed',
   'yandex_file_unavailable','yandex_file_too_large','yandex_file_empty',
   'yandex_file_redirect_limit','yandex_zip_size_invalid',
   'yandex_zip_footer_missing','yandex_zip_multidisk_forbidden',
   'yandex_zip_directory_invalid','yandex_zip_central_invalid',
   'yandex_zip_entry_unsupported','yandex_zip_name_invalid',
   'yandex_zip_unexpected_file','yandex_zip_local_invalid',
   'yandex_zip_data_truncated','yandex_zip_decompressed_limit',
   'yandex_zip_checksum_mismatch','yandex_report_json_invalid',
   'yandex_zip_empty','yandex_report_sheet_structure_unknown',
   'yandex_amount_overflow'];
  const code=allowed.includes(e?.message)?e.message:mapSafeYandexError(e);
  return json(503,{code});
 }
}
