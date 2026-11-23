import { FINANCE_FIELDS, exactFinanceJson, normalizeReport, normalizeOperation, splitLookupRowIds } from './wb-finance-sync-core.mjs';

// Private scheduled Worker. No public endpoint, no XLSX writes, no Ozon access.
// One Finance API call per cron tick (5 minutes); WB officially allows 1/minute.
const HOST='https://finance-api.wildberries.ru/api/finance/v1/sales-reports';
const ACCOUNT='4271851',PAGE_SIZE=250,LIST_LIMIT=1000;
const INSERT_ROW="INSERT INTO wb_finance_api_rows (account_id,report_id,rrd_id,seller_oper_name,vendor_code,quantity,for_pay_kop,delivery_service_kop,paid_storage_kop,deduction_kop,penalty_kop,additional_payment_kop,paid_acceptance_kop,source_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,report_id,rrd_id) DO NOTHING";

function safeCode(error){
  const s=error?.message;
  return typeof s==='string'&&/^(invalid_|sale_|cursor_|report_|money_|response_)/.test(s)
    ?s.slice(0,60):'sync_failed';
}
function samaraDay(date){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Samara',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
async function hash(row){
  const bytes=new TextEncoder().encode(JSON.stringify(row));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
async function bounded(response){
  const reader=response.body?.getReader();
  if(!reader)throw Error('response_empty');
  const decoder=new TextDecoder('utf-8',{fatal:true});let total=0,text='';
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done){text+=decoder.decode();break;}
      total+=value.byteLength;
      if(total>2*1024*1024)throw Error('response_too_large');
      text+=decoder.decode(value,{stream:true});
    }
  }finally{await reader.cancel().catch(()=>{});}
  return exactFinanceJson(text);
}
async function wbRequest(env,path,body){
  const response=await fetch(HOST+path,{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),
    headers:{Authorization:env.WB_API_TOKEN,Accept:'application/json',
      'Content-Type':'application/json'},body
  });
  if(response.status===204){await response.body?.cancel().catch(()=>{});return null;}
  if(response.status!==200){
    await response.body?.cancel().catch(()=>{});
    if(response.status===429)throw Error('report_rate_limited');
    throw Error('report_upstream_'+response.status);
  }
  return bounded(response);
}
async function release(db,code){
  await db.prepare("UPDATE wb_finance_api_runtime SET last_status=?,lock_until_ms=0,updated_at=CURRENT_TIMESTAMP WHERE account_id=?")
    .bind(code,ACCOUNT).run();
}
async function lock(db,now){
  await db.prepare("INSERT OR IGNORE INTO wb_finance_api_runtime(account_id) VALUES (?)")
    .bind(ACCOUNT).run();
  const result=await db.prepare("UPDATE wb_finance_api_runtime SET last_request_ms=?,lock_until_ms=?,updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND last_request_ms <= ? AND lock_until_ms <= ? RETURNING account_id")
    .bind(now,now+120000,ACCOUNT,now-70000,now).first();
  return Boolean(result);
}
async function discover(db,env,offset,day){
  const raw=await wbRequest(env,'/list',JSON.stringify({
    dateFrom:'2026-10-01',dateTo:day,period:'weekly',limit:LIST_LIMIT,offset
  }));
  const rows=raw===null?[]:raw;
  if(!Array.isArray(rows)||rows.length>LIST_LIMIT)throw Error('invalid_list');
  const reports=rows.map(normalizeReport);
  if(new Set(reports.map(x=>x.reportId)).size!==reports.length)throw Error('invalid_list_duplicates');
  const statements=reports.map(x=>db.prepare("INSERT INTO wb_finance_api_reports (account_id,report_id,date_from,date_to,report_type,bank_payment_kop) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,report_id) DO NOTHING")
    .bind(ACCOUNT,x.reportId,x.dateFrom,x.dateTo,x.reportType,x.bankPaymentKop));
  const complete=rows.length<LIST_LIMIT;
  statements.push(db.prepare("UPDATE wb_finance_api_runtime SET last_list_day=?,list_offset=?,last_status=?,lock_until_ms=0,updated_at=CURRENT_TIMESTAMP WHERE account_id=?")
    .bind(complete?day:'',complete?0:offset+rows.length,complete?'list_complete':'list_paging',ACCOUNT));
  await db.batch(statements);
  // Idempotence: changed closed reports must never silently replace stored metadata.
  for(const x of reports){
    const old=await db.prepare("SELECT date_from,date_to,report_type,bank_payment_kop FROM wb_finance_api_reports WHERE account_id=? AND report_id=?")
      .bind(ACCOUNT,x.reportId).first();
    if(old&&(old.date_from!==x.dateFrom||old.date_to!==x.dateTo||old.report_type!==x.reportType||old.bank_payment_kop!==x.bankPaymentKop)){
      await db.prepare("UPDATE wb_finance_api_reports SET status='conflict',error_code='report_metadata_changed',updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND report_id=?")
        .bind(ACCOUNT,x.reportId).run();
    }
  }
  return complete?'list_complete':'list_paging';
}
async function finishReport(db,report){
  const sums=await db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(CASE WHEN seller_oper_name='Продажа' THEN 1 ELSE 0 END),0) AS sales,COALESCE(SUM(CASE WHEN seller_oper_name='Возврат' THEN 1 ELSE 0 END),0) AS returns,COALESCE(SUM(CASE WHEN seller_oper_name='Продажа' THEN for_pay_kop WHEN seller_oper_name='Возврат' THEN -for_pay_kop ELSE 0 END),0)-COALESCE(SUM(delivery_service_kop+paid_storage_kop+deduction_kop+penalty_kop+paid_acceptance_kop),0) AS payout FROM wb_finance_api_rows WHERE account_id=? AND report_id=?")
    .bind(ACCOUNT,report.report_id).first();
  const status=sums.payout===report.bank_payment_kop?'complete':'mismatch';
  await db.prepare("UPDATE wb_finance_api_reports SET status=?,row_count=?,sales_count=?,returns_count=?,api_calculated_payment_kop=?,error_code=?,updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND report_id=?")
    .bind(status,sums.n,sums.sales,sums.returns,sums.payout,status==='complete'?'':'payout_needs_review',ACCOUNT,report.report_id).run();
  await release(db,status==='complete'?'report_complete':'report_mismatch');
  return status;
}
// Recover an existing mismatch only when the EXACT discrepancy is explained
// by the already stored paid acceptance operations, with complete row coverage.
// No API mutation and no report metadata/operations changes. Idempotent.
export async function reconcileStoredAcceptanceMismatch(db){
  const report=await db.prepare(
    "SELECT report_id,bank_payment_kop,api_calculated_payment_kop,row_count "+
    "FROM wb_finance_api_reports WHERE account_id=? AND status='mismatch' "+
    "AND error_code='payout_needs_review' ORDER BY report_id LIMIT 1"
  ).bind(ACCOUNT).first();
  if(!report)return false;
  if(typeof report.report_id!=='string'||!/^\\d{1,20}$/.test(report.report_id)||
    !Number.isSafeInteger(report.bank_payment_kop)||
    !Number.isSafeInteger(report.api_calculated_payment_kop)||
    !Number.isSafeInteger(report.row_count)||report.row_count<1)return false;
  const totals=await db.prepare(
    "SELECT COUNT(*) AS n, "+
    "COALESCE(SUM(paid_acceptance_kop),0) AS acceptance, "+
    "COALESCE(SUM(CASE WHEN seller_oper_name='Продажа' THEN for_pay_kop "+
    "WHEN seller_oper_name='Возврат' THEN -for_pay_kop ELSE 0 END),0) "+
    "-COALESCE(SUM(delivery_service_kop+paid_storage_kop+deduction_kop+"+
    "penalty_kop+paid_acceptance_kop),0) AS corrected "+
    "FROM wb_finance_api_rows WHERE account_id=? AND report_id=?"
  ).bind(ACCOUNT,report.report_id).first();
  if(!totals||!Number.isSafeInteger(totals.n)||
    !Number.isSafeInteger(totals.acceptance)||
    !Number.isSafeInteger(totals.corrected)||
    totals.n!==report.row_count||totals.acceptance<=0||
    totals.corrected!==report.bank_payment_kop||
    report.api_calculated_payment_kop-report.bank_payment_kop!==
      totals.acceptance)return false;
  const updated=await db.prepare(
    "UPDATE wb_finance_api_reports SET status='complete',"+
    "api_calculated_payment_kop=?,error_code='',"+
    "updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND report_id=? "+
    "AND status='mismatch' AND error_code='payout_needs_review' "+
    "AND api_calculated_payment_kop=? AND bank_payment_kop=? "+
    "AND row_count=?"
  ).bind(totals.corrected,ACCOUNT,report.report_id,
    report.api_calculated_payment_kop,report.bank_payment_kop,
    report.row_count).run();
  return updated?.meta?.changes===1;
}

async function getPage(db,env,report){
  // rrdId is serialized as a JSON number without JS Number conversion, preserving int64.
  if(!/^\d{1,20}$/.test(report.cursor_rrd_id))throw Error('invalid_cursor');
  const body='{"limit":'+PAGE_SIZE+',"rrdId":'+report.cursor_rrd_id+',"fields":'+JSON.stringify(FINANCE_FIELDS)+'}';
  const raw=await wbRequest(env,'/detailed/'+report.report_id,body);
  if(raw===null)return finishReport(db,report);
  if(!Array.isArray(raw)||raw.length<1||raw.length>PAGE_SIZE)throw Error('invalid_page');
  const ops=raw.map(x=>normalizeOperation(x,report.report_id));
  let cursor=BigInt(report.cursor_rrd_id);
  for(const op of ops){
    const next=BigInt(op.rrdId);
    if(next<=cursor)throw Error('cursor_not_increasing');
    cursor=next;
  }
  const rows=await Promise.all(ops.map(async op=>({...op,hash:await hash(op)})));
  const hashes=new Map();
  for(const batchIds of splitLookupRowIds(rows)){
    const query="SELECT rrd_id,source_hash FROM wb_finance_api_rows WHERE account_id=? AND report_id=? AND rrd_id IN ("+batchIds.map(()=>'?').join(',')+")";
    const existing=await db.prepare(query).bind(ACCOUNT,report.report_id,...batchIds).all();
    for(const row of existing.results||[])hashes.set(row.rrd_id,row.source_hash);
  }
  if(rows.some(x=>hashes.has(x.rrdId)&&hashes.get(x.rrdId)!==x.hash)){
    await db.prepare("UPDATE wb_finance_api_reports SET status='conflict',error_code='api_operation_changed' WHERE account_id=? AND report_id=?")
      .bind(ACCOUNT,report.report_id).run();
    await release(db,'api_operation_changed');
    return 'conflict';
  }
  const statements=rows.map(x=>db.prepare(INSERT_ROW)
    .bind(ACCOUNT,report.report_id,x.rrdId,x.sellerOperName,x.vendorCode,x.quantity,
      x.forPayKop,x.deliveryServiceKop,x.paidStorageKop,x.deductionKop,x.penaltyKop,
      x.additionalPaymentKop,x.paidAcceptanceKop,x.hash));
  statements.push(db.prepare("UPDATE wb_finance_api_reports SET cursor_rrd_id=?,status='paging',updated_at=CURRENT_TIMESTAMP WHERE account_id=? AND report_id=?")
    .bind(cursor.toString(),ACCOUNT,report.report_id));
  statements.push(db.prepare("UPDATE wb_finance_api_runtime SET last_status='page_received',lock_until_ms=0,updated_at=CURRENT_TIMESTAMP WHERE account_id=?")
    .bind(ACCOUNT));
  await db.batch(statements);
  return 'page_received';
}
export async function runWbSync(env,date=new Date()){
  if(env?.WB_FINANCE_AUTO_SYNC!=='enabled')return 'disabled';
  if(!env?.WB_REPORT_SNAPSHOT_DB||env.WB_REPORT_ACCOUNT_ID!==ACCOUNT||
    typeof env.WB_API_TOKEN!=='string'||!env.WB_API_TOKEN||/\s/.test(env.WB_API_TOKEN))
    return 'configuration_unavailable';
  const db=env.WB_REPORT_SNAPSHOT_DB;
  const prior=await db.prepare("SELECT last_status FROM wb_finance_api_runtime WHERE account_id=?").bind(ACCOUNT).first();
  if(prior?.last_status?.startsWith('halted_'))return 'manual_intervention_required';
  if(!await lock(db,date.getTime()))return 'throttled';
  try{
    if(await reconcileStoredAcceptanceMismatch(db)){
      await release(db,'acceptance_reconciled');
      return 'acceptance_reconciled';
    }
    const day=samaraDay(date);
    const state=await db.prepare("SELECT last_list_day,list_offset FROM wb_finance_api_runtime WHERE account_id=?")
      .bind(ACCOUNT).first();
    if(state.last_list_day!==day)return await discover(db,env,state.list_offset,day);
    const next=await db.prepare("SELECT * FROM wb_finance_api_reports WHERE account_id=? AND status IN ('pending','paging') ORDER BY date_from,report_id LIMIT 1")
      .bind(ACCOUNT).first();
    if(!next){await release(db,'up_to_date');return 'up_to_date';}
    return await getPage(db,env,next);
  }catch(error){
    const code=safeCode(error);
    await release(db,'halted_'+code);
    return 'halted_'+code;
  }
}
export default {
  async fetch(){return new Response('Not found',{status:404});},
  async scheduled(event,env,ctx){
    ctx.waitUntil(runWbSync(env,new Date(event.scheduledTime)).catch(()=>{}));
  }
};
