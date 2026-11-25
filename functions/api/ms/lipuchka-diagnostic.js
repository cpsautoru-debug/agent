import {verifySession} from '../auth/session.js';

// Owner-only, bounded accounting reconciliation. No writes to MoySklad.
const OFFICE='https://autosklad63-office-staging.pages.dev';
const PATH='/api/ms/lipuchka-diagnostic';
const ROOT='https://api.moysklad.ru/api/remap/1.2/';
const ITEM='cfd25ff1-1ac3-11f1-0a80-16a500223fe0';
const API=ROOT+'report/turnover/byoperations';
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
const json=(status,p)=>new Response(JSON.stringify(p),{status,headers:HEADERS});
async function boundedJson(response){
  const reader=response.body?.getReader();if(!reader)throw Error('no_response_body');
  let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const {done,value}=await reader.read();if(done){raw+=decoder.decode();break;}
    size+=value.byteLength;if(size>512*1024)throw Error('oversize_report');
    raw+=decoder.decode(value,{stream:true});}}
  finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(raw);
}
const docType=row=>{
  const href=row?.operation?.meta?.href;
  const m=typeof href==='string'&&href.match(/\/entity\/([a-z]+)\//);
  return m?m[1]:'unknown';
};
const docNumber=row=>typeof row?.operation?.name==='string'?row.operation.name.slice(0,32):null;
const position=row=>({
  type:docType(row),number:docNumber(row),
  moment:typeof row?.moment==='string'?row.moment.slice(0,30):null,
  quantity:typeof row?.quantity==='number'&&Number.isFinite(row.quantity)?row.quantity:null
});
export function createLipuchkaHandler(fetcher=fetch){
  return async function({request,env}){
    if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
    const url=new URL(request.url);
    if(url.origin!==OFFICE||url.pathname!==PATH||url.search||url.hash)
      return json(400,{code:'invalid_scope'});
    if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||!env.OZON_FINANCE_DB)
      return json(503,{code:'owner_auth_unavailable'});
    const sub=await verifySession(request,env.OFFICE_SESSION_SECRET);
    if(!sub)return json(401,{code:'owner_session_required'});
    const owner=await env.OZON_FINANCE_DB.prepare(
      "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
    ).bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
    if(owner?.allowed!==1)return json(403,{code:'owner_only'});
    if(typeof env.MS_API_TOKEN!=='string'||!env.MS_API_TOKEN||/\s/.test(env.MS_API_TOKEN))
      return json(503,{code:'ms_token_unavailable'});
    const groups={},examples={first:[],last:[]};
    let total=null,read=0,pages=0;
    try{
      for(let offset=0;offset<1000;offset+=100){
        const upstream=new URL(API);
        upstream.searchParams.set('filter','assortment='+ROOT+'entity/product/'+ITEM);
        upstream.searchParams.set('limit','100');
        upstream.searchParams.set('offset',String(offset));
        const response=await fetcher(upstream.toString(),{
          method:'GET',redirect:'manual',
          headers:{Authorization:'Bearer '+env.MS_API_TOKEN,Accept:'application/json;charset=utf-8'},
          signal:AbortSignal.timeout(20000)
        });
        if(response.status!==200){
          let msErrorCode=null;
          if([400,412,415,422].includes(response.status)){
            try{
              const errorBody=await boundedJson(response);
              const numeric=errorBody?.errors?.[0]?.code;
              if(Number.isSafeInteger(numeric)&&numeric>=0)msErrorCode=numeric;
            }catch{}
          }
          await response.body?.cancel().catch(()=>{});
          return json(200,{code:'ms_lipuchka_upstream_partial',readOnly:true,changedRecords:0,
            upstreamHttp:response.status,msErrorCode,offset,pages,rowsRead:read,expectedRows:total,
            warning:'No conclusions until all report pages have been read'});
        }
        const data=await boundedJson(response),rows=data?.rows;
        if(!Array.isArray(rows)||!Number.isSafeInteger(data?.meta?.size)||data.meta.size<0)
          throw Error('invalid_report_page');
        if(total===null)total=data.meta.size;
        if(total!==data.meta.size||rows.length!==Math.min(100,Math.max(0,total-offset)))
          throw Error('report_changed_or_incomplete');
        pages++;
        for(const r of rows){
          const t=docType(r);
          groups[t]??={count:0,quantitySum:0,hasQuantity:0,positive:0,negative:0};
          const g=groups[t];g.count++;
          if(typeof r.quantity==='number'&&Number.isFinite(r.quantity)){
            g.hasQuantity++;g.quantitySum+=r.quantity;
            if(r.quantity>0)g.positive+=r.quantity;
            if(r.quantity<0)g.negative+=r.quantity;
          }
          const entry=position(r);
          if(examples.first.length<5)examples.first.push(entry);
          examples.last.push(entry);if(examples.last.length>5)examples.last.shift();
        }
        read+=rows.length;
        if(read>=total)break;
        if(rows.length===0)throw Error('missing_page');
      }
      return json(200,{code:read===total?'ms_lipuchka_turnover_complete':'ms_lipuchka_turnover_partial',
        itemCode:'728562180',itemName:'Липучка жесткая 25мм',
        readOnly:true,changedRecords:0,expectedRows:total,rowsRead:read,pages,
        complete:read===total,groups,examples,
        caution:'Signed report quantity is not validated against individual source documents. Stock baseline, actual receipts and physical count remain unverified.'});
    }catch{
      return json(502,{code:'ms_lipuchka_report_unverified',readOnly:true,changedRecords:0,expectedRows:total,rowsRead:read,pages});
    }
  };
}
export const onRequestGet=createLipuchkaHandler();
