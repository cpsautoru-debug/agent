import {mkdir,open,lstat,readFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const TYPES=new Set(['supply','demand','loss','move','purchaseorder','customerorder','processing','processingorder','productiontask','productionstagecompletion']);
const fields=new Set(['accountId','type','documentId','hash','updated','applied']);
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.has(k))||!UUID.test(input.accountId||'')||!UUID.test(input.documentId||'')||!TYPES.has(input.type)||!HASH.test(input.hash||'')||typeof input.applied!=='boolean'||input.updated!==undefined&&input.updated!==null&&(typeof input.updated!=='string'||input.updated.length>40||!Number.isFinite(Date.parse(input.updated))))throw Error('invalid-observation');
 return {key:input.accountId.toLowerCase()+':'+input.type+':'+input.documentId.toLowerCase(),hash:input.hash,applied:input.applied,updated:input.updated??null};
}
/** Local review-only observations. Never a claim that an external movement was processed. */
export async function observeDocument(directory,input){
 const record=validate(input),dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});
 if((await lstat(dir)).isSymbolicLink())throw Error('audit-ledger-unsafe-path');
 const lockPath=join(dir,'observations.lock'),file=join(dir,'observations.jsonl');let lock;
 try{lock=await open(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('audit-ledger-busy');throw Error('audit-ledger-unavailable');}
 try{
  let raw='';try{const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8*1024*1024)throw Error('audit-ledger-corrupt');raw=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw Error('audit-ledger-corrupt');}
  if(raw&&!raw.endsWith('\n'))throw Error('audit-ledger-corrupt');
  const lines=raw?raw.trimEnd().split('\n'):[];if(lines.length>10000)throw Error('audit-ledger-corrupt');
  let previous=null;let seq=0;
  for(const line of lines){
   let row;try{row=JSON.parse(line);}catch{throw Error('audit-ledger-corrupt');}
   const parts=String(row.key||'').split(':');
   if(row.schema!==1||row.seq!==++seq||parts.length!==3||!UUID.test(parts[0])||!TYPES.has(parts[1])||!UUID.test(parts[2])||!HASH.test(row.hash||'')||typeof row.applied!=='boolean'||!['new-needs-review','changed-needs-review'].includes(row.state))throw Error('audit-ledger-corrupt');
   if(Object.keys(row).some(k=>!['schema','seq','key','hash','applied','updated','state','observedAt'].includes(k))||typeof row.observedAt!=='string'||!Number.isFinite(Date.parse(row.observedAt)))throw Error('audit-ledger-corrupt');
   try{validate({accountId:parts[0],type:parts[1],documentId:parts[2],hash:row.hash,applied:row.applied,updated:row.updated});}catch{throw Error('audit-ledger-corrupt');}
   if(row.key===record.key)previous=row;
  }
  if(previous?.hash===record.hash&&previous.applied===record.applied&&previous.updated===record.updated)return {state:'already-observed',key:record.key,seq:previous.seq,readOnly:true,writeOperations:[]};
  if(lines.length>=10000)throw Error('audit-ledger-full');
  const state=previous?'changed-needs-review':'new-needs-review';
  const row={schema:1,seq:seq+1,...record,state,observedAt:new Date().toISOString()};
  const serialized=JSON.stringify(row)+'\n';if(Buffer.byteLength(raw)+Buffer.byteLength(serialized)>8*1024*1024)throw Error('audit-ledger-full');
  const handle=await open(file,'a',0o600);try{await handle.writeFile(serialized);await handle.sync();}finally{await handle.close();}
  return {state,key:record.key,seq:row.seq,readOnly:true,writeOperations:[]};
 }finally{await lock.close();await unlink(lockPath);}
}
