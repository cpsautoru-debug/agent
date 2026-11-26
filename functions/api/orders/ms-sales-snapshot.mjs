const TYPES=['counterparty','saleschannel','organization','store'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function readSalesDirectories(db,now=Date.now()){
 const result={};
 if(!db)return result;
 const {results}=await db.prepare('SELECT entity_type,fetched_at,row_count,items_json FROM ms_sales_directory_snapshots').all();
 for(const row of results||[]){
  const age=now-Date.parse(row.fetched_at);
  if(!TYPES.includes(row.entity_type)||!Number.isFinite(age)||age< -60000||age>21600000)continue;
  let items;try{items=JSON.parse(row.items_json);}catch{continue;}
  if(!Array.isArray(items)||items.length!==row.row_count||items.length>200||items.some(x=>!UUID.test(x?.id||'')||typeof x.name!=='string'||typeof x.archived!=='boolean')||new Set(items.map(x=>x.id.toLowerCase())).size!==items.length)continue;
  result[row.entity_type]={items,fetchedAt:row.fetched_at};
 }
 return result;
}
const exact=(snapshot,name)=>{const rows=snapshot?.items.filter(x=>!x.archived&&x.name===name)||[];return rows.length===1?rows[0].id:null;};
const has=(snapshot,id)=>!!id&&snapshot?.items.some(x=>!x.archived&&x.id.toLowerCase()===id.toLowerCase())===true;
export function salesDirectoryEvidence(directories,approved,route){
 const agentId=exact(directories.counterparty,approved?.agentName),channelId=exact(directories.saleschannel,approved?.channelName);
 const storeVerified=has(directories.store,route?.store_id),organizationVerified=has(directories.organization,route?.organization_id);
 return {agentId,channelId,verified:!!agentId&&!!channelId,storeVerified,organizationVerified,missingDirectories:TYPES.filter(t=>!directories[t])};
}
