import {verifySession} from '../auth/session.js';
import {monthBounds} from '../ozon/profit-model.js';
import {WB_ACCOUNT} from '../../../web/office/wb-unit-economics-core.mjs';
const HEADER={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADER});
const OWNER="SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub=? AND email=? AND role='owner' LIMIT 1";
const TARGET='ce9dd331-929d-4c3e-9073-368de3346bc9';
const int=n=>Number.isSafeInteger(n);
const add=(a,b)=>{const sum=a+b;if(!int(sum))throw Error('unsafe_amount');return sum;};
export function summarizeIncomeEvidence(month,source,wb){
 monthBounds(month);
 const doc=source?.configuration?.month;
 if(source?.target!==TARGET||doc?.month!==month||
    doc.periodVerified!==true||!Array.isArray(doc.rows)||
    !Array.isArray(wb?.operations)||!Array.isArray(wb?.reports))
   throw Error('income_sources_incomplete');
 const services=['Выручка','Возврат выручки','Баллы за скидки','Программы партнёров'];
 const amounts=Object.fromEntries(services.map(x=>[x,{rows:0,amountKopecks:0}]));
 for(const row of doc.rows){
   if(!services.includes(row.service))continue;
   if(!int(row.amountKopecks))throw Error('invalid_ozon_amount');
   amounts[row.service].amountKopecks=add(amounts[row.service].amountKopecks,row.amountKopecks);
   amounts[row.service].rows++;
 }
 const wbByOperation={};
 for(const row of wb.operations){
   if(typeof row.seller_oper_name!=='string'||!int(row.rows)||row.rows<0||
      !int(row.for_pay_kop))throw Error('invalid_wb_amount');
   if(Object.hasOwn(wbByOperation,row.seller_oper_name))throw Error('duplicate_wb_operation');
   wbByOperation[row.seller_oper_name]={rows:row.rows,forPayKopecks:row.for_pay_kop};
 }
 const bounds=monthBounds(month);
 const end=new Date(Date.parse(bounds.end+'T00:00:00Z')-86400000)
   .toISOString().slice(0,10);
 const savedRows=wb.operations.reduce((n,x)=>add(n,x.rows),0);
 const declaredRows=wb.reports.reduce((n,x)=>add(n,x.row_count),0);
 if(savedRows!==declaredRows)throw Error('wb_report_row_count_mismatch');
 const reportTypes=new Map();
 for(const row of wb.reports){
   if(!['complete'].includes(row.status)||!int(row.row_count)||row.row_count<0||
      typeof row.date_from!=='string'||typeof row.date_to!=='string'||
      row.date_from<bounds.start||row.date_to>end||
      !int(row.report_type))throw Error('invalid_wb_coverage');
   const periods=reportTypes.get(row.report_type)||[];
   periods.push({from:row.date_from,to:row.date_to});
   reportTypes.set(row.report_type,periods);
 }
 // Report periods can overlap at boundaries; never claim full October
 // coverage from one report, or tax-income completeness from settlements.
 return {code:'entity_income_evidence',month,readOnly:true,
   source:'OZON_OWNER_XLSX_AND_WB_REPORT_D1',
   ozon:{reportRows:doc.rows.length,sourceVerifiedPeriod:true,
     serviceAmounts:amounts,taxIncomeConfirmed:false},
   wb:{reports:wb.reports.length,operationAmounts:wbByOperation,
     periodStart:bounds.start,periodEnd:end,
     payoutIsNotTaxRevenue:true,taxIncomeConfirmed:false},
   unknownChannels:['yandex','avito','offline'],
   taxpayerMappingConfirmed:false,
   fnsRegisterReconciled:false,
   distributionReady:false,changedRecords:0};
}
export function createEntityIncomeEvidence({now=Date.now}={}){
 return async function({request,env}){
  if(request.method!=='GET')return json(405,{code:'method_not_allowed'});
  const url=new URL(request.url);
  const month=url.searchParams.get('month');
  if(url.pathname!=='/api/finance/income-evidence'||url.hash||
    url.searchParams.size!==1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))
    return json(400,{code:'invalid_period'});
  let bounds;try{bounds=monthBounds(month);}catch{return json(400,{code:'invalid_period'});}
  if(Date.parse(bounds.end+'T00:00:00Z')>now())return json(400,{code:'period_not_closed'});
  if(!env?.OFFICE_SESSION_SECRET||!env.OFFICE_ALLOWED_EMAIL||
     !env.OZON_FINANCE_DB||!env.WB_REPORT_SNAPSHOT_DB||
     env.WB_REPORT_ACCOUNT_ID!==WB_ACCOUNT||
     typeof env.OZON_FINANCE_SYNC?.getProfitData!=='function')
    return json(503,{code:'sources_unavailable'});
  let sub;
  try{sub=await verifySession(request,env.OFFICE_SESSION_SECRET);}
  catch{return json(401,{code:'unauthorized'});}
  if(!sub)return json(401,{code:'unauthorized'});
  try{
    const allowed=await env.OZON_FINANCE_DB.prepare(OWNER)
      .bind(sub,env.OFFICE_ALLOWED_EMAIL).first();
    if(allowed?.allowed!==1)return json(403,{code:'forbidden'});
  }catch{return json(503,{code:'owner_verification_unavailable'});}
  try{
    const finance=await env.OZON_FINANCE_SYNC.getProfitData(month);
    const operations=await env.WB_REPORT_SNAPSHOT_DB.prepare(
      'SELECT r.seller_oper_name, COUNT(*) AS rows, SUM(r.for_pay_kop) AS for_pay_kop '+
      'FROM wb_finance_api_rows r JOIN wb_finance_api_reports p '+
      'ON p.report_id=r.report_id AND p.account_id=r.account_id '+
      "WHERE p.account_id=? AND p.date_from>=? AND p.date_to<? AND p.status='complete' "+
      'GROUP BY r.seller_oper_name'
    ).bind(WB_ACCOUNT,bounds.start,bounds.end).all();
    const reports=await env.WB_REPORT_SNAPSHOT_DB.prepare(
      'SELECT date_from,date_to,report_type,status,row_count '+
      'FROM wb_finance_api_reports WHERE account_id=? AND date_from>=? AND date_to<? '
      +'ORDER BY date_from,report_type'
    ).bind(bounds.start,bounds.end).all();
    if(!Array.isArray(operations?.results)||!Array.isArray(reports?.results))
      throw Error('missing_wb_rows');
    return json(200,summarizeIncomeEvidence(month,finance,{
      operations:operations.results,reports:reports.results
    }));
  }catch{return json(503,{code:'income_evidence_unavailable'});}
 };
}
export const onRequestGet=createEntityIncomeEvidence();
