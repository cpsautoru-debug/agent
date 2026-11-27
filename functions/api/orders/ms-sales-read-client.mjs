// Inspired by https://github.com/theYahia/moysklad-mcp (MIT), v3.1.0.
// Independent implementation: fixed origin, GET-only, bounded sequential requests.
const BASE='https://api.moysklad.ru/api/remap/1.2/';
const allowed=/^(entity\/(counterparty|saleschannel|organization|store|assortment|customerorder|demand|salesreturn|move|enter|loss|inventory|paymentin|cashin)(\/[a-f0-9-]{36})?|report\/stock\/(all|bystore|current))(\?|$)/i;
export function createMsReadClient({token,fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
 if(typeof token!=='string'||!token||/\s/.test(token))throw Error('ms_token_unavailable');
 let budget=0,window=now(),tail=Promise.resolve(),requests=0;
 const read=async path=>{
  if(typeof path!=='string'||!allowed.test(path)||path.includes('#')||path.includes('\\'))throw Error('ms_read_path_denied');
  const url=new URL(path,BASE);
  if(url.origin!=='https://api.moysklad.ru'||!url.pathname.startsWith('/api/remap/1.2/'))throw Error('ms_read_path_denied');
  const weight=path.startsWith('report/stock/')?5:1;
  for(let attempt=0;attempt<2;attempt++){
   if(++requests>20)throw Error('ms_read_budget_exhausted');
   if(now()-window>=3000){window=now();budget=0;}
   if(budget+weight>10){await sleep(Math.max(0,3000-(now()-window)));window=now();budget=0;}
   budget+=weight;
   const response=await fetcher(url.toString(),{method:'GET',redirect:'manual',headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8',...(path.startsWith('entity/assortment?')?{'X-Lognex-Remap-Beta-Feature':'assortmentWithoutStock'}:{})},signal:AbortSignal.timeout(15000)});
   if(response.ok){
    const reader=response.body?.getReader();if(!reader)throw Error('ms_missing_body');
    let bytes=0,raw='';const decoder=new TextDecoder();
    try{for(;;){const {done,value}=await reader.read();if(done){raw+=decoder.decode();break;}bytes+=value.byteLength;if(bytes>524288)throw Error('ms_response_limit');raw+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
    return JSON.parse(raw);
   }
   await response.body?.cancel().catch(()=>{});
   if(attempt===0&&(response.status===429||response.status>=500)){
    const delay=Number(response.headers.get('X-Lognex-Retry-After'))||Number(response.headers.get('Retry-After'))*1000||1000;
    if(delay>10000)throw Error('ms_retry_later');
    await sleep(Math.max(1000,delay));continue;
   }
   throw Error('ms_http_'+response.status);
  }
 };
 return path=>{const result=tail.then(()=>read(path));tail=result.catch(()=>{});return result;};
}
