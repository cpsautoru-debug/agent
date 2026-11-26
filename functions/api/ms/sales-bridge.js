import {validBridgeSecret,verifyBridgeRequest} from '../../../workers/ms-production-bridge-auth.js';
import {directoryPage} from '../orders/ms-sales-directory.js';
import {createMsReadClient} from '../orders/ms-sales-read-client.mjs';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/sales-bridge';
const TYPES=['counterparty','saleschannel','organization','store'];
const reply=(status,data)=>new Response(JSON.stringify({readOnly:true,changedRecords:0,...data}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function createSalesBridge({fetcher=fetch,now=Date.now}={}){
 return async({request,env})=>{
  if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
  // Separate credential: production-only clients cannot read sales directories.
  if(!validBridgeSecret(env?.MS_SALES_BRIDGE_SECRET))return reply(503,{code:'sales_bridge_not_configured'});
  const u=new URL(request.url);
  if(u.origin!==ORIGIN||u.pathname!==PATH||u.hash)return reply(400,{code:'invalid_scope'});
  let verified=false;
  try{verified=await verifyBridgeRequest(env.MS_SALES_BRIDGE_SECRET,request.headers.get('X-MS-Bridge-Time'),request.headers.get('X-MS-Bridge-Signature'),u.pathname+u.search,now());}catch{}
  if(!verified)return reply(401,{code:'unauthorized'});
  const keys=[...u.searchParams.keys()],type=u.searchParams.get('type'),offset=u.searchParams.get('offset');
  if(keys.length!==2||!keys.includes('type')||!keys.includes('offset')||!TYPES.includes(type)||!/^\d{1,5}$/.test(offset||'')||Number(offset)>10000)return reply(400,{code:'invalid_scope'});
  try{return reply(200,{code:'sales_directory_ok',...await directoryPage(createMsReadClient({token:env.MS_API_TOKEN,fetcher}),type,Number(offset))});}
  catch{return reply(503,{code:'sales_directory_read_failed'});}
 };
}
export const onRequest=createSalesBridge();
