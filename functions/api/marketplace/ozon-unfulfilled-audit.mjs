// Bounded read-only comparison; never certifies all open obligations.
const URL='https://api-seller.ozon.ru/v4/posting/fbs/unfulfilled/list';
export async function auditOzonUnfulfilled({fetcher=fetch,account,token,now=Date.now(),baseline=[]}={}){
 if(account!=='171189'||typeof token!=='string'||!token||!Number.isFinite(now))throw Error('audit_configuration');
 const filter={cutoff_from:new Date(now-180*86400000).toISOString(),cutoff_to:new Date(now+30*86400000).toISOString(),statuses:['awaiting_packaging','awaiting_deliver']};
 const rows=new Map(),cursors=new Set();let cursor='';
 for(let pages=1;pages<=4;pages++){
  const response=await fetcher(URL,{method:'POST',headers:{'Client-Id':account,'Api-Key':token,'Content-Type':'application/json'},body:JSON.stringify({filter,limit:50,sort_dir:'asc',cursor}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('audit_upstream_'+response.status);
  const data=await response.json();
  if(!Array.isArray(data.postings)||data.postings.length>50||typeof data.has_next!=='boolean')throw Error('audit_schema');
  for(const p of data.postings){
   if(typeof p.posting_number!=='string'||!p.posting_number||rows.has(p.posting_number)||!filter.statuses.includes(p.status))throw Error('audit_row');
   rows.set(p.posting_number,p.status);
  }
  if(!data.has_next){
   const old=new Map(baseline.map(x=>[x.posting_number,x.status]));
   return {readOnly:true,allOpenVerified:false,scope:filter,pages,received:rows.size,
    onlyUnfulfilled:[...rows.keys()].filter(k=>!old.has(k)).length,onlyBaseline:[...old.keys()].filter(k=>!rows.has(k)).length,
    statusMismatch:[...rows].filter(([k,v])=>old.has(k)&&old.get(k)!==v).length};
  }
  if(typeof data.cursor!=='string'||!data.cursor||cursors.has(data.cursor))throw Error('audit_cursor');
  cursors.add(data.cursor);cursor=data.cursor;
 }
 throw Error('audit_page_limit');
}
