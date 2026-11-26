import {createMsReadClient} from './ms-sales-read-client.mjs';
const ROOT='https://api.moysklad.ru/api/remap/1.2/entity/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function exactEntity(rows,type,name){
 if(!Array.isArray(rows)||typeof name!=='string'||!name.trim())return null;
 const matches=rows.filter(x=>x?.name===name&&x.archived!==true);
 if(matches.length!==1)return null;
 const row=matches[0];
 return UUID.test(row.id||'')&&row.meta?.type===type&&row.meta?.href===ROOT+type+'/'+row.id?row.id.toLowerCase():null;
}
export async function resolveCounterparty(read,{agentName,channelName}){
 // Exact equality only; the configured names must have been approved for this seller account.
 const find=async(type,name)=>{
  if(typeof name!=='string'||!name.trim()||name.length>200||/[;=\u0000-\u001f]/.test(name))return null;
  const data=await read('entity/'+type+'?'+new URLSearchParams({filter:'name='+name,limit:'2'}));
  if(!Array.isArray(data?.rows)||data.meta?.size!==data.rows.length||data.rows.length!==1||data.meta.nextHref)return null;
  return exactEntity(data.rows,type,name);
 };
 const agentId=await find('counterparty',agentName);
 const channelId=await find('saleschannel',channelName);
 return {agentId,channelId,verified:!!agentId&&!!channelId};
}

export function resolveCounterpartyFromApi(env, names, options={}){
 return resolveCounterparty(createMsReadClient({...options,token:env.MS_API_TOKEN}),names);
}
