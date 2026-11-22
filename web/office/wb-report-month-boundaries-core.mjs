// Reports span dates. Full-month P&L cannot be inferred from a collection
// of weekly report totals, even if every returned report is marked complete.
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const validMoney=x=>Number.isSafeInteger(x);
export function classifyWbReportMonth(rows,month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!Array.isArray(rows)||
    rows.length>2000)throw Error('invalid_wb_report_month');
  const first=month+'-01';
  const next=new Date(first+'T00:00:00Z');
  next.setUTCMonth(next.getUTCMonth()+1);
  const exclusive=next.toISOString().slice(0,10);
  const reportIds=new Set();
  const out={code:'wb_report_month_boundary_audit',readOnly:true,
    changedRecords:0,month,scope:'REPORT_PERIOD_METADATA_NOT_TRANSACTION_DATES',
    whollyInside:[],crossing:[],pending:[],totalWhollyInsideKopecks:0,
    bankStatementVerified:false,calendarMonthComplete:false,
    netProfitKopecks:null};
  for(const r of rows){
    if(!/^\d{1,20}$/.test(String(r?.report_id??''))||
      reportIds.has(String(r.report_id))||!day(r.date_from)||
      !day(r.date_to)||r.date_from>r.date_to||
      !['complete','pending','paging','failed','conflict'].includes(r.status)||
      !validMoney(r.bank_payment_kop)||!Number.isSafeInteger(r.row_count)||
      r.row_count<0)throw Error('invalid_wb_report_metadata');
    reportIds.add(String(r.report_id));
    if(r.date_from>=exclusive||r.date_to<first)continue;
    const full=r.date_from>=first&&r.date_to<exclusive;
    const item={reportId:String(r.report_id),from:r.date_from,to:r.date_to,
      status:r.status,payoutKopecks:r.bank_payment_kop,operationCount:r.row_count};
    if(r.status!=='complete')out.pending.push(item);
    else if(full){
      out.whollyInside.push(item);
      const sum=out.totalWhollyInsideKopecks+r.bank_payment_kop;
      if(!Number.isSafeInteger(sum))throw Error('wb_report_sum_overflow');
      out.totalWhollyInsideKopecks=sum;
    }else out.crossing.push(item);
  }
  out.completeReportCount=out.whollyInside.length;
  out.crossingReportCount=out.crossing.length;
  out.pendingReportCount=out.pending.length;
  out.hasUnallocatedBoundary=out.crossing.length>0;
  out.monthAttributionVerified=false;
  return out;
}
