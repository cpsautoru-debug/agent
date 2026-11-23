import { WorkerEntrypoint } from 'cloudflare:workers';

// AutoSklad63 — Ozon Performance Ads, read-only and fail-closed.
// Bindings: OZON_PERFORMANCE_CLIENT_ID, OZON_PERFORMANCE_CLIENT_SECRET,
// ADS_READ_TOKEN (separate random secret used only by the office backend).
// No cron, writes, mutable advertising actions or public financial responses.
const HOST='https://api-performance.ozon.ru';
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
};
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const validMonth=value=>/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value||'');
const utcToday=()=>new Date().toISOString().slice(0,10);
const dateWindow=month=>{
  const [year,mon]=month.split('-').map(Number);
  const first=month+'-01';
  const last=new Date(Date.UTC(year,mon,0)).toISOString().slice(0,10);
  if(last>=utcToday())return null; // closed reporting months only
  return {first,last};
};
async function fetchJson(fetcher,url,init){
  const response=await fetcher(url,{...init,signal:AbortSignal.timeout(12000)});
  if(!response.ok)return {ok:false,status:response.status};
  const type=response.headers.get('content-type')||'';
  if(!type.includes('json'))return {ok:false,status:502};
  const data=await response.json();
  return {ok:true,data};
}
export async function readOzonExpense(month,env,fetcher=fetch){
  if(!validMonth(month)||!dateWindow(month))return {status:400,body:{code:'invalid_closed_month'}};
  if(!env?.OZON_PERFORMANCE_CLIENT_ID||!env?.OZON_PERFORMANCE_CLIENT_SECRET)
    return {status:503,body:{code:'ozon_credentials_missing'}};
  try{
    const token=await fetchJson(fetcher,HOST+'/api/client/token',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({client_id:env.OZON_PERFORMANCE_CLIENT_ID,
        client_secret:env.OZON_PERFORMANCE_CLIENT_SECRET,
        grant_type:'client_credentials'})
    });
    if(!token.ok)return {status:503,body:{
      code:token.status===401||token.status===403?
        'ozon_performance_auth_rejected':'ozon_performance_token_unavailable'
    }};
    const access=token.data?.access_token;
    if(typeof access!=='string'||!access)
      return {status:503,body:{code:'ozon_performance_token_unrecognized'}};
    const {first,last}=dateWindow(month);
    const u=new URL(HOST+'/api/client/statistics/expense/json');
    u.searchParams.set('dateFrom',first);
    u.searchParams.set('dateTo',last);
    const expenses=await fetchJson(fetcher,u.toString(),{
      method:'GET',headers:{authorization:'Bearer '+access,accept:'application/json'}
    });
    if(!expenses.ok)return {status:503,body:{
      code:expenses.status===401||expenses.status===403?
        'ozon_performance_expense_unauthorized':
        expenses.status===429?'ozon_performance_rate_limited':
          'ozon_performance_expense_unavailable'
    }};
    // The response format varies between API versions; do not interpret
    // unknown monetary fields as zero or guess how bonus spend is deducted.
    const root=expenses.data;
    const isArray=Array.isArray(root);
    const rows=isArray?root:
      Array.isArray(root?.rows)?root.rows:
      Array.isArray(root?.items)?root.items:
      Array.isArray(root?.data)?root.data:null;
    if(!rows||rows.length>10000)
      return {status:422,body:{
        code:'ozon_expense_schema_unverified',
        source:'OZON_PERFORMANCE_API',month,readOnly:true,
        monetaryTotalsVerified:false
      }};
    if(rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
      return {status:422,body:{code:'ozon_expense_rows_unrecognized'}};
    const keys=[...new Set(rows.slice(0,3).flatMap(x=>Object.keys(x)))]
      .filter(x=>/^[a-zA-Z_][a-zA-Z0-9_]{0,80}$/.test(x))
      .slice(0,30);
    return {status:200,body:{
      code:'ozon_expense_source_preview',
      source:'OZON_PERFORMANCE_API',
      month,dateFrom:first,dateTo:last,
      readOnly:true,changedRecords:0,
      recordCount:rows.length,fieldNames:keys,
      columnAudit:['moneySpent','bonusSpent','prepaymentSpent']
        .map(key=>expenseColumnAudit(rows,key)),
      currency:'RUB',totalExpenseKopecks:null,
      monetaryTotalsVerified:false,
      reconciledToFinance:false,
      note:'Ozon API ответил. Суммы не вычисляются до проверки формата и сверки начислений Ozon Finance.'
    }};
  }catch{
    return {status:503,body:{code:'ozon_performance_network_or_schema_error'}};
  }
}
// Read-only independent column diagnostics. Strict cents conversion avoids
// JS floating point round-off and silently substituting 0 for missing values.
function decimalKopecks(value){
  if(typeof value!=='string'&&typeof value!=='number')return null;
  // Ozon sometimes serializes display-formatted rubles: decimal comma,
  // grouping spaces or non-breaking spaces. Never guess currency units.
  const normalized=String(value).trim().replace(/[\u00a0\u202f ]/g,'')
    .replace(',', '.');
  if(!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(normalized))
    return null;
  const text=normalized;
  const negative=text.startsWith('-');
  const unsigned=negative?text.slice(1):text;
  const [rub,frac='']=unsigned.split('.');
  const abs=BigInt(rub)*100n+BigInt(frac.padEnd(2,'0'));
  const kopecks=negative?-abs:abs;
  return kopecks<=BigInt(Number.MAX_SAFE_INTEGER)&&kopecks>=BigInt(Number.MIN_SAFE_INTEGER)
    ?Number(kopecks):null;
}
function expenseColumnAudit(rows,field){
  let sum=0n,missing=0,invalid=0,valid=0;
  const invalidFormats={object:0,array:0,boolean:0,decimalPrecision:0,other:0};
  for(const row of rows){
    if(!Object.hasOwn(row,field)||row[field]===null||row[field]===''){
      missing++;continue;
    }
    const n=decimalKopecks(row[field]);
    if(n===null){
      invalid++;
      const value=row[field];
      const kind=Array.isArray(value)?'array':
        value&&typeof value==='object'?'object':
        typeof value==='boolean'?'boolean':
        typeof value==='string'&&/[.,]\d{3,}$/.test(value.trim())?
          'decimalPrecision':'other';
      invalidFormats[kind]++;
      continue;
    }
    sum+=BigInt(n);valid++;
  }
  const total=valid===rows.length&&rows.length>0&&
    sum<=BigInt(Number.MAX_SAFE_INTEGER)&&sum>=BigInt(Number.MIN_SAFE_INTEGER)
    ?Number(sum):null;
  return {field,validRows:valid,missingRows:missing,invalidRows:invalid,
    invalidFormats,rawColumnSumKopecks:total,sourceReconciled:false};
}

// Use one guarded implementation for both the public default entrypoint
// and the named Pages Service Binding entrypoint. No anonymous/public
// access to advertising evidence is added.
async function handleAdsRequest(request,env){
    const url=new URL(request.url);
    if(request.method!=='GET')return reply(405,{code:'method_not_allowed'});
    if(url.pathname==='/health'&&!url.search)
      return reply(200,{code:'ozon_ads_worker_staging',readOnly:true,
        authConfigured:Boolean(env?.OZON_PERFORMANCE_CLIENT_ID)&&
          Boolean(env?.OZON_PERFORMANCE_CLIENT_SECRET),
        accessProtected:Boolean(env?.ADS_READ_TOKEN),
        expenseSync:'not_verified'});
    if(url.pathname!=='/api/internal/expense'||url.searchParams.size!==1||
      !url.searchParams.has('month'))
      return reply(404,{code:'not_found'});
    // Until this *third* secret is configured, all data requests are denied.
    if(typeof env?.ADS_READ_TOKEN!=='string'||env.ADS_READ_TOKEN.length<32)
      return reply(503,{code:'private_access_not_configured'});
    const auth=request.headers.get('authorization');
    if(auth!=='Bearer '+env.ADS_READ_TOKEN)
      return reply(401,{code:'unauthorized'});
    const outcome=await readOzonExpense(url.searchParams.get('month'),env);
    return reply(outcome.status,outcome.body);
}

export default class OzonAdsWorker extends WorkerEntrypoint {
  fetch(request){return handleAdsRequest(request,this.env);}
}

// Select this named entrypoint in Cloudflare Pages Settings → Bindings.
// Unlike the old non-RPC readOzonExpense function, this is an actual
// WorkerEntrypoint with fetch(request) and the same bearer protection.
export class OzonAdsInternal extends WorkerEntrypoint {
  fetch(request){return handleAdsRequest(request,this.env);}

  // Named entrypoints use RPC methods, not an HTTP fetch() subrequest.
  // Only the authenticated Pages owner backend knows the shared token.
  async expensePreview(month,sharedToken){
    const env=this.env;
    if(typeof env?.ADS_READ_TOKEN!=='string'||env.ADS_READ_TOKEN.length<32)
      return {status:503,body:{code:'private_access_not_configured'}};
    if(typeof sharedToken!=='string'||sharedToken!==env.ADS_READ_TOKEN)
      return {status:401,body:{code:'unauthorized'}};
    return readOzonExpense(month,env);
  }
}
