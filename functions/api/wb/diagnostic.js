import {verifySession} from '../auth/session.js';
const ORIGIN='https://autosklad63-office-staging.pages.dev';
const REPORT='865265818',LIMIT=1000,MAX_BYTES=4*1024*1024;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Origin'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
const exact=raw=>JSON.parse(raw.replace(/"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,t=>t[0]==='"'?t:JSON.stringify(t)));
function money(value){if(typeof value!=='string'||!/^[-]?\d+(?:\.\d+)?$/.test(value))throw Error('money');const negative=value.startsWith('-');let [whole,frac='']=(negative?value.slice(1):value).split('.');frac=frac.replace(/0+$/,'');if(frac.length>2)throw Error('precision');const n=BigInt(whole)*100n+BigInt(frac.padEnd(2,'0'));return negative?-n:n;}
export function summarizeFinanceCheck(raw){
 const rows=exact(raw);
 if(!Array.isArray(rows)||!rows.length||rows.length>=LIMIT)throw Error('incomplete');
 let sales=0,returns=0,settlement=0n,charges=0n;const operations=Object.create(null),seen=new Set();
 for(const row of rows){
  if(row.reportId!==REPORT||typeof row.rrdId!=='string'||!/^\d+$/.test(row.rrdId)||seen.has(row.rrdId)||row.currency!=='RUB'||typeof row.sellerOperName!=='string'||!row.sellerOperName)throw Error('scope');
  seen.add(row.rrdId);operations[row.sellerOperName]=(operations[row.sellerOperName]||0)+1;
  for(const field of ['deliveryService','paidStorage','deduction','penalty'])charges+=money(row[field]);
  if(row.sellerOperName==='Продажа'||row.sellerOperName==='Возврат'){
   if(!/^1(?:\.0+)?$/.test(row.quantity||''))throw Error('quantity');
   if(row.sellerOperName==='Продажа'){sales++;settlement+=money(row.forPay)}else{returns++;settlement-=money(row.forPay)}
  }
 }
 const payout=settlement-charges;
 return {code:'finance_report_received',reportId:REPORT,financeRights:'CONFIRMED_BY_HTTP_200',operations:rows.length,operationCounts:operations,sales,returns,payoutKop:payout.toString(),comparison:{payoutMatches:payout===7922633n,salesMatch:sales===22,returnsMatch:returns===1},comparisonBasis:'same_components_as_existing_XLSX_preview',apiCogsExpected:false,apiWrites:0,d1Writes:0};
}
async function boundedText(response){const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});try{while(true){const {done,value}=await reader.read();if(done){text+=decoder.decode();return text}size+=value.byteLength;if(size>MAX_BYTES)throw Error('size');text+=decoder.decode(value,{stream:true})}}finally{void reader.cancel().catch(()=>{})}}
export function createFinanceCheckHandler(fetcher=fetch){
 return async function({request,env}){
  try{
   if(!['GET','POST'].includes(request.method))return json(405,{code:'method_not_allowed'});
   if(new URL(request.url).origin!==ORIGIN||new URL(request.url).search)return json(403,{code:'scope_denied'});
   if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB||env.WB_REPORT_ACCOUNT_ID!=='4271851'||env.WB_REPORT_SAVE_MODE!=='test-only')return json(503,{code:'configuration_unavailable'});
   const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
   if(!sub)return json(401,{code:'unauthorized'});
   const owner=await env.OZON_FINANCE_DB.prepare("SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1").bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
   if(owner?.allowed!==1)return json(403,{code:'forbidden'});
   if(typeof env.WB_API_TOKEN!=='string'||!env.WB_API_TOKEN||/\s/.test(env.WB_API_TOKEN))return json(503,{code:'finance_token_unavailable'});
   if(request.method==='GET')return json(200,{code:'owner_check_available',reportId:REPORT});
   if(request.headers.get('Origin')!==ORIGIN||request.headers.get('X-WB-Finance-Check')!=='865265818'||request.headers.get('Content-Type')!=='application/json')return json(403,{code:'invalid_origin'});
   // Fixed empty request only; no arbitrary report ID or URL.
   const reader=request.body?.getReader();if(!reader)return json(400,{code:'invalid_body'});
   let bytes=0,body='';const decoder=new TextDecoder();try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>16)return json(400,{code:'invalid_body'});body+=decoder.decode(r.value,{stream:true})}}finally{void reader.cancel().catch(()=>{})}
   if(!/^\s*\{\s*\}\s*$/.test(body))return json(400,{code:'invalid_body'});
   let response;
   try{response=await fetcher('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed/'+REPORT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:env.WB_API_TOKEN,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({limit:LIMIT,rrdId:0,fields:['reportId','rrdId','sellerOperName','currency','quantity','forPay','deliveryService','paidStorage','deduction','penalty']})})}catch{return json(502,{code:'finance_transport_failure',upstreamRequests:1,retry:false})}
   if(response.status!==200){void response.body?.cancel().catch(()=>{});return json(422,{code:({401:'finance_token_rejected',403:'finance_permission_denied',429:'finance_rate_limited',204:'finance_no_data'})[response.status]||'finance_upstream_failure',upstreamHttp:response.status,upstreamRequests:1,retry:false})}
   try{return json(200,{...summarizeFinanceCheck(await boundedText(response)),upstreamHttp:200,upstreamRequests:1,retry:false})}catch{return json(422,{code:'finance_response_not_reconciled',financeRights:'CONFIRMED_BY_HTTP_200',upstreamHttp:200,upstreamRequests:1,retry:false})}
  }catch{return json(503,{code:'finance_check_unavailable',retry:false})}
 };
}
export const onRequest=createFinanceCheckHandler();
