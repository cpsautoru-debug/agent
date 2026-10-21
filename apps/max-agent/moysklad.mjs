import {createHash,timingSafeEqual} from 'node:crypto';

export const MOYSKLAD_BASE='https://api.moysklad.ru/api/remap/1.2';
export const MOYSKLAD_RESOURCES=Object.freeze({
  assortment:'/entity/assortment',products:'/entity/product',variants:'/entity/variant',bundles:'/entity/bundle',units:'/entity/uom',stores:'/entity/store',
  stock:'/report/stock/all',stockByStore:'/report/stock/bystore',
  purchaseOrders:'/entity/purchaseorder',supplies:'/entity/supply',customerOrders:'/entity/customerorder',demands:'/entity/demand',losses:'/entity/loss',moves:'/entity/move',
  processingOrders:'/entity/processingorder',processings:'/entity/processing',processingPlans:'/entity/processingplan',
  productionTasks:'/entity/productiontask',productionStageCompletions:'/entity/productionstagecompletion',
});
const parts=Object.freeze({supplies:['positions'],demands:['positions'],purchaseOrders:['positions'],customerOrders:['positions'],losses:['positions'],moves:['positions'],processings:['materials','products'],processingPlans:['materials','products','stages'],productionStageCompletions:['materials','products']});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const queryKeys=new Set(['limit','offset','filter','order','search']);
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export class MoyskladError extends Error{
  constructor(code,status=0){super(code);this.name='MoyskladError';this.code=code;this.status=status;}
  toJSON(){return {error:this.code,...(this.status?{upstreamStatus:this.status}:{}),readOnly:true};}
}
function pathFor(resource,id,part){
  if(!Object.hasOwn(MOYSKLAD_RESOURCES,resource))throw new MoyskladError('invalid-resource');
  let path=MOYSKLAD_RESOURCES[resource];
  if(id!==undefined){if(!UUID.test(id))throw new MoyskladError('invalid-document-id');path+='/'+id;}
  if(part!==undefined){if(!id||!parts[resource]?.includes(part))throw new MoyskladError('invalid-document-part');path+='/'+part;}
  return path;
}
function queryFor(query={}){
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(query)){
    if(!queryKeys.has(key))throw new MoyskladError('invalid-query');
    if(['limit','offset'].includes(key)){const n=Number(value);if(!int(n,key==='limit'?1:0,key==='limit'?1000:10000000))throw new MoyskladError('invalid-pagination');params.set(key,String(n));}
    else{if(typeof value!=='string'||!value||value.length>2000||/[\r\n\0]/.test(value))throw new MoyskladError('invalid-query');params.set(key,value);}
  }
  return params;
}
async function readJSON(response,maxBytes){
  const declared=Number(response.headers.get('content-length'));
  if(declared>maxBytes){await response.body?.cancel();throw new MoyskladError('response-too-large');}
  if(!response.body)throw new MoyskladError('invalid-response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new MoyskladError('response-too-large');}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new MoyskladError('invalid-response');}
}
function backoff(response,attempt,now){
  const ms=response.headers.get('x-lognex-retry-after'),retry=response.headers.get('retry-after');
  const wait=ms!==null?Number(ms):retry!==null?(/^\d+(\.\d+)?$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now):500*2**attempt;
  if(!Number.isFinite(wait)||wait<0||wait>30000)throw new MoyskladError('retry-deferred',response.status);
  return Math.max(500,Math.ceil(wait));
}
/** Sole token source is process.env. No token argument, writes, redirects or arbitrary URLs. */
export function createMoyskladClient({fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,minIntervalMs=500,timeoutMs=15000,retries=2,maxBytes=8*1024*1024,maxQueued=25}={}){
  if(!int(minIntervalMs,0,60000)||!int(timeoutMs,1,60000)||!int(retries,0,3)||!int(maxQueued,1,100)||!int(maxBytes,1,16*1024*1024))throw new MoyskladError('invalid-client-options');
  let tail=Promise.resolve(),waiting=0,nextAt=0;
  const enqueue=operation=>{
    if(waiting>=maxQueued)return Promise.reject(new MoyskladError('queue-full'));
    waiting++;const task=tail.then(operation);tail=task.catch(()=>{});return task.finally(()=>waiting--);
  };
  async function get(path,query={}){
    const params=queryFor(query),url=MOYSKLAD_BASE+path+(params.size?'?'+params:'');
    return enqueue(async()=>{
      const token=process.env.MOYSKLAD_API_TOKEN;
      if(typeof token!=='string'||!token||/\s/.test(token))throw new MoyskladError('not-configured');
      for(let attempt=0;attempt<=retries;attempt++){
        const wait=Math.max(0,nextAt-now());if(wait)await sleep(wait);nextAt=now()+minIntervalMs;
        let response;
        try{response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8','Accept-Encoding':'gzip',...(path==='/entity/assortment'?{'X-Lognex-Remap-Beta-Feature':'assortmentWithoutStock'}:{})}});}
        catch(error){throw new MoyskladError(error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'network-error');}
        if([429,502,503,504].includes(response.status)){
          if(attempt===retries){await response.body?.cancel();throw new MoyskladError(response.status===429?'rate-limited':'upstream-unavailable',response.status);}
          let delay;try{delay=backoff(response,attempt,now());}finally{await response.body?.cancel();}nextAt=Math.max(nextAt,now()+delay);continue;
        }
        if(!response.ok){await response.body?.cancel();throw new MoyskladError(({401:'unauthorized',403:'forbidden',404:'not-found',415:'unsupported-encoding'})[response.status]||'upstream-error',response.status);}
        if(response.headers.get('x-ratelimit-remaining')==='0'){
          const reset=Number(response.headers.get('x-lognex-reset')||response.headers.get('x-lognex-retry-after'));
          if(Number.isFinite(reset)&&reset>0)nextAt=Math.max(nextAt,now()+Math.min(reset,30000));
        }
        try{const data=await readJSON(response,maxBytes);if(!data||typeof data!=='object'||Array.isArray(data)||data.errors)throw new MoyskladError('invalid-response');return data;}
        catch(error){if(error instanceof MoyskladError)throw error;throw new MoyskladError(error?.name==='AbortError'||error?.name==='TimeoutError'?'timeout':'invalid-response');}
      }
    });
  }
  async function page(resource,query={},id,part){
    const path=pathFor(resource,id,part),params={limit:100,offset:0,...query};
    if(['stock','stockByStore'].includes(resource)){
      let filter=String(params.filter||'');
      if(!/(^|;)stockMode=/.test(filter))filter='stockMode=all'+(filter?';'+filter:'');
      if(resource==='stock'&&!/(^|;)quantityMode=/.test(filter))filter='quantityMode=all;'+filter;
      params.filter=filter;
    }
    const data=await get(path,params);
    if(!Array.isArray(data.rows)||data.rows.length>Number(params.limit))throw new MoyskladError('invalid-page');
    if(data.meta?.offset!==undefined&&data.meta.offset!==Number(params.offset))throw new MoyskladError('pagination-inconsistent');
    if(data.meta?.nextHref){
      let next;try{next=new URL(data.meta.nextHref);}catch{throw new MoyskladError('invalid-next-page');}
      const current=new URL(MOYSKLAD_BASE+path);
      if(next.origin!==current.origin||next.pathname!==current.pathname||next.username||next.password||next.hash||Number(next.searchParams.get('offset'))!==Number(params.offset)+data.rows.length)throw new MoyskladError('invalid-next-page');
    }
    return data;
  }
  async function all(resource,query={},options={}){
    const {maxPages=100,maxRows=10000,maxTotalBytes=32*1024*1024,id,part}=options;
    if(!int(maxPages,1,1000)||!int(maxRows,1,100000)||!int(maxTotalBytes,1,64*1024*1024))throw new MoyskladError('invalid-bounds');
    queryFor(query);let offset=Number(query.offset||0),rows=[],expectedSize=null,totalBytes=0;const ids=new Set();
    for(let index=0;index<maxPages;index++){
      const result=await page(resource,{...query,offset},id,part),size=result.meta?.size;
      totalBytes+=Buffer.byteLength(JSON.stringify(result.rows));if(totalBytes>maxTotalBytes)throw new MoyskladError('snapshot-too-large');
      if(size!==undefined){if(!int(size,0,100000000)||expectedSize!==null&&size!==expectedSize)throw new MoyskladError('snapshot-changed');expectedSize=size;}
      for(const row of result.rows){const identity=row.id||row.meta?.href;if(identity){if(ids.has(identity))throw new MoyskladError('pagination-duplicate');ids.add(identity);}}
      if(rows.length+result.rows.length>maxRows)throw new MoyskladError('row-limit-exceeded');rows.push(...result.rows);offset+=result.rows.length;
      if(expectedSize!==null&&offset>expectedSize)throw new MoyskladError('pagination-inconsistent');
      const more=Boolean(result.meta?.nextHref)||(expectedSize!==null?offset<expectedSize:result.rows.length===Number(query.limit||100));
      if(!more)return {rows,complete:true,pages:index+1,readOnly:true};
      if(!result.rows.length)throw new MoyskladError('pagination-stalled');
    }
    throw new MoyskladError('page-limit-exceeded');
  }
  return Object.freeze({page,all,document:async(resource,id)=>get(pathFor(resource,id)),
    positions:(resource,id,part='positions',query={},options={})=>all(resource,query,{...options,id,part}),
    async connection(){try{await page('stores',{limit:1});return {connected:true,readOnly:true,verifiedResource:'stores',otherPermissionsVerified:false};}catch(error){return {connected:false,readOnly:true,...(error instanceof MoyskladError?error.toJSON():{error:'unavailable'})};}}
  });
}
const digest=value=>createHash('sha256').update(value).digest();
/** Protected, bounded GET pages only. No startup calls and no reuse of upstream token as a reader key. */
export async function handleMoyskladRead(req,res,url,env,client){
  if(!url.pathname.startsWith('/api/moysklad/'))return false;
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));return true;};
  const key=env.MOYSKLAD_READ_API_KEY;
  if(typeof key!=='string'||key.length<32||key===process.env.MOYSKLAD_API_TOKEN)return send(503,{error:'read-access-not-configured'});
  const auth=req.headers.authorization;
  if(typeof auth!=='string'||auth.length>1024||!auth.startsWith('Bearer ')||!timingSafeEqual(digest(auth.slice(7)),digest(key)))return send(401,{error:'unauthorized'});
  if(req.method!=='GET')return send(405,{error:'read-only'});
  const resource=url.pathname.slice('/api/moysklad/'.length);
  try{
    if(resource==='connection'){if(url.search)return send(400,{error:'invalid-query'});return send(200,await client.connection());}
    if(!Object.hasOwn(MOYSKLAD_RESOURCES,resource))return send(404,{error:'not-found'});
    const query={};for(const [k,v] of url.searchParams){if(Object.hasOwn(query,k))return send(400,{error:'duplicate-query'});query[k]=v;}
    if(query.limit!==undefined&&(!int(Number(query.limit),1,100)))return send(400,{error:'page-limit-100'});
    const result=await client.page(resource,query);return send(200,{...result,readOnly:true});
  }catch(error){const safe=error instanceof MoyskladError?error:new MoyskladError('unavailable');return send(safe.code.startsWith('invalid-')?400:safe.code==='queue-full'?429:502,safe.toJSON());}
}
