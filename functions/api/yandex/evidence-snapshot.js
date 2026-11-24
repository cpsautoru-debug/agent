import {json,verifyYandexOwner} from './finance-source.js';
// Persist a deliberately restricted product-level summary, never buyer,
// order, email, bank or transaction records. An authenticated browser sends
// summaries of archives it has audited; server checks source report IDs against
// canonical D1 jobs. The captured summary is NOT an accountant's certification.
const MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/;
const ID=/^[a-zA-Z0-9_-]{1,255}$/;
const EXPECTED=[
 ['all','orders','orders'],['all','services','services'],
 ['all','payments','payments'],
 ['149082506','realization','realization149082506'],
 ['149106500','realization','realization149106500']
];
const MAX=90000;
const integer=x=>Number.isSafeInteger(x)&&Math.abs(x)<=1e13;
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
const schema=`CREATE TABLE IF NOT EXISTS yandex_month_evidence (
 month TEXT PRIMARY KEY,
 report_ids_json TEXT NOT NULL,
 evidence_json TEXT NOT NULL,
 provenance TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT`;
export function validateYandexEvidenceSnapshot(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||
  !MONTH.test(body.month||'')||
  Date.UTC(Number(body.month.slice(0,4)),Number(body.month.slice(5,7)),1)>Date.now()||
  !body.reportIds||
  !body.evidence||typeof body.evidence!=='object')
  throw Error('invalid_snapshot');
 if(Object.keys(body.reportIds).length!==5||
  !EXPECTED.every(([, ,k])=>ID.test(body.reportIds[k]||'')))
  throw Error('invalid_report_ids');
 const e=body.evidence;
 if(e.ownerEntity!=='ИП Жилина Ольга'||
    e.netProfitKopecks!==null||
    !['partial','preliminary_contribution_ready'].includes(e.status)||
    ![e.orderAfterServiceKopecks,e.deliveredCostKopecks,
      e.returnedValueKopecks,e.preliminaryContributionKopecks]
     .every(x=>x===null||integer(x))||
    !count(e.orderRows)||!Array.isArray(e.skus)||
    e.skus.length>500||!Array.isArray(e.issues)||e.issues.length>10)
  throw Error('invalid_evidence');
 if(e.status==='preliminary_contribution_ready'&&(
    !integer(e.orderAfterServiceKopecks)||
    !integer(e.deliveredCostKopecks)||
    !integer(e.returnedValueKopecks)||
    e.preliminaryContributionKopecks!==
     e.orderAfterServiceKopecks-e.deliveredCostKopecks||
    e.issues.length>0))
  throw Error('inconsistent_contribution');
 const unique=new Set();
 for(const x of e.skus){
  if(![149082506,149106500].includes(x?.partnerId)||
     typeof x.shopSku!=='string'||!x.shopSku||x.shopSku.length>150||
     typeof x.name!=='string'||x.name.length>200||
     !count(x.deliveredUnits)||!count(x.returnedUnits)||
     !['matched_exact','matched_owner','matched_model',
       'missing','cost_conflict'].includes(x.costStatus)||
     (x.costKopecks!==null&&(
       !integer(x.costKopecks)||x.costKopecks<=0))||
     (x.costKopecks!==null&&!['matched_exact','matched_owner'].includes(
       x.costStatus))||unique.has(x.partnerId+':'+x.shopSku))
   throw Error('invalid_sku_row');
  unique.add(x.partnerId+':'+x.shopSku);
 }
 for(const issue of e.issues){
  if(![149082506,149106500].includes(issue?.partnerId)||
      typeof issue.reason!=='string'||issue.reason.length>80||
      !/^[a-z_]+$/.test(issue.reason))
   throw Error('invalid_sku_coverage');
 }
 if(e.status==='preliminary_contribution_ready'&&
    e.skus.some(x=>x.deliveredUnits>0&&x.costKopecks===null))
  throw Error('unverified_cost_coverage');
 return {month:body.month,reportIds:body.reportIds,
  evidence:{ownerEntity:e.ownerEntity,status:e.status,
   orderAfterServiceKopecks:e.orderAfterServiceKopecks,
   deliveredCostKopecks:e.deliveredCostKopecks,
   returnedValueKopecks:e.returnedValueKopecks,
   preliminaryContributionKopecks:e.preliminaryContributionKopecks,
   orderRows:e.orderRows,skus:e.skus,issues:e.issues,
   netProfitKopecks:null,
   provenance:'owner_browser_audited_summary_not_bank_or_tax_closeout'}};
}
export async function onRequestPost({request,env}){
 if(request.method!=='POST')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url);
 if(url.pathname!=='/api/yandex/evidence-snapshot'||url.search||url.hash)
  return json(400,{code:'invalid_scope'});
 if(request.headers.get('Origin')!==url.origin||
    request.headers.get('Sec-Fetch-Site')==='cross-site')
  return json(403,{code:'origin_denied'});
 const auth=await verifyYandexOwner(request,env);
 if(auth)return json(auth.status,{code:auth.code});
 let parsed;
 try{
  const body=await request.text();
  if(body.length>MAX)throw Error('oversized');
  parsed=validateYandexEvidenceSnapshot(JSON.parse(body));
 }catch{return json(400,{code:'invalid_snapshot'});}
 try{
  const rows=await env.OZON_FINANCE_DB.prepare(
   'SELECT scope,report_type,report_id,status FROM yandex_finance_report_jobs WHERE month=?'
  ).bind(parsed.month).all();
  if(!Array.isArray(rows.results)||!EXPECTED.every(([scope,type,key])=>{
   const matches=rows.results.filter(x=>x.scope===scope&&
    x.report_type===type&&x.report_id===parsed.reportIds[key]&&
    x.status==='DONE');
   return matches.length===1;
  }))return json(409,{code:'report_id_mismatch'});
  await env.OZON_FINANCE_DB.prepare(schema).run();
  await env.OZON_FINANCE_DB.prepare(
   `INSERT INTO yandex_month_evidence
     (month,report_ids_json,evidence_json,provenance)
    VALUES (?,?,?,'owner_browser_audited_summary')
    ON CONFLICT(month) DO UPDATE SET
     report_ids_json=excluded.report_ids_json,
     evidence_json=excluded.evidence_json,
     provenance=excluded.provenance,updated_at=CURRENT_TIMESTAMP`
  ).bind(parsed.month,JSON.stringify(parsed.reportIds),
   JSON.stringify(parsed.evidence)).run();
  return json(200,{code:'yandex_month_evidence_saved',month:parsed.month,
   sourceKind:'owner_browser_audited_summary',netProfitKopecks:null});
 }catch{return json(503,{code:'snapshot_store_unavailable'});}
}
export async function onRequestGet({request,env}){
 if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
 const url=new URL(request.url),month=url.searchParams.get('month');
 if(url.pathname!=='/api/yandex/evidence-snapshot'||
    url.searchParams.size!==1||url.hash||!MONTH.test(month||''))
  return json(400,{code:'invalid_scope'});
 const auth=await verifyYandexOwner(request,env);
 if(auth)return json(auth.status,{code:auth.code});
 try{
  const record=await env.OZON_FINANCE_DB.prepare(
   'SELECT report_ids_json,evidence_json,updated_at FROM yandex_month_evidence WHERE month=?'
  ).bind(month).first();
  if(!record)return json(200,{code:'yandex_month_evidence_not_saved',
   month,netProfitKopecks:null});
  const snapshot=validateYandexEvidenceSnapshot({month,
   reportIds:JSON.parse(record.report_ids_json),
   evidence:JSON.parse(record.evidence_json)});
  const registry=await env.OZON_FINANCE_DB.prepare(
   'SELECT scope,report_type,report_id,status FROM yandex_finance_report_jobs WHERE month=?'
  ).bind(month).all();
  if(!Array.isArray(registry.results)||!EXPECTED.every(([scope,type,key])=>
    registry.results.filter(x=>x.scope===scope&&
     x.report_type===type&&x.report_id===snapshot.reportIds[key]&&
     x.status==='DONE').length===1))
   return json(200,{code:'yandex_month_evidence_stale',
    month,netProfitKopecks:null});
  return json(200,{code:'yandex_month_evidence_available',
   ...snapshot,updatedAt:record.updated_at,readOnly:true,
   netProfitKopecks:null,sourceKind:'owner_browser_audited_summary'});
 }catch{return json(503,{code:'snapshot_read_unavailable'});}
}
