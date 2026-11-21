// Pure, read-only WB Finance API monitor domain rules shared by Pages status.
// Data here originate ONLY from the separate WB API D1, never from saved XLSX.
// 04:00-06:55 UTC = 08:00-10:55 Samara; current scheduled operating window.
// The UI must not call an overnight pause a stalled five-minute cron.
export const EXPECTED_INTERVAL_MIN=5;
export const MAX_SUCCESS_GAP_MS=20*60*1000;
export const REPORT_LIMIT=300;
export const ACCOUNT='4271851';
const statuses=['pending','paging','complete','mismatch','conflict','failed'];
const validId=x=>typeof x==='string'&&/^\d{1,20}$/.test(x);
const int=x=>Number.isSafeInteger(x);
const text=(x,max=80)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u001f\u007f]/u.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'));
const timestamp=x=>x===null||x===undefined||(
  text(x,30)&&/^\d{4}-\d{2}-\d{2} \d\d:\d\d:\d\d$/.test(x));
const nullableInt=x=>x===null||int(x);

export function samaraClock(nowMs){
  if(!int(nowMs)||nowMs<0)throw Error('invalid_monitor_time');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Samara',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(nowMs));
  const num=key=>Number(parts.find(part=>part.type===key)?.value);
  const hour=num('hour'),minute=num('minute');
  if(!int(hour)||!int(minute)||hour<0||hour>23||minute<0||minute>59)
    throw Error('invalid_monitor_clock');
  return {hour,minute,minOfDay:hour*60+minute};
}
export function monitorHealth(runtime,nowMs){
  const status=runtime?.last_status;
  const lastRequest=runtime?.last_request_ms;
  if(!text(status,70)||!int(lastRequest)||lastRequest<0)
    throw Error('invalid_monitor_runtime');
  const time=samaraClock(nowMs);
  const inWindow=time.minOfDay>=8*60&&time.minOfDay<11*60;
  if(status.startsWith('halted_'))return 'halted';
  if(lastRequest>nowMs+5*60*1000)return 'clock_error';
  if(inWindow){
    if(lastRequest>0&&nowMs-lastRequest<=MAX_SUCCESS_GAP_MS)
      return 'on_schedule';
    // Allow the first four 5-minute ticks to start each day's window.
    if(time.minOfDay<8*60+20)return 'starting_window';
    return 'delayed';
  }
  return lastRequest===0?'never_started':'outside_window';
}

export function summarizeWbFinance(runtime,rawReports,operationsStored,nowMs=Date.now()){
  if(!Array.isArray(rawReports)||rawReports.length>REPORT_LIMIT||
    !int(operationsStored)||operationsStored<0||
    !runtime||!text(runtime.last_status,70)||
    !int(runtime.last_request_ms)||runtime.last_request_ms<0||
    !(runtime.last_list_day===''||day(runtime.last_list_day))||
    !int(runtime.list_offset)||runtime.list_offset<0||
    !timestamp(runtime.updated_at))throw Error('wb_monitor_unverified');

  const seen=new Set(),counts=Object.fromEntries(statuses.map(x=>[x,0]));
  let completedOperations=0,bankComplete=0,bankMismatchCount=0;
  const reports=rawReports.map(row=>{
    if(!validId(row?.report_id)||seen.has(row.report_id)||
      !day(row.date_from)||!day(row.date_to)||row.date_from>row.date_to||
      ![1,2].includes(row.report_type)||!statuses.includes(row.status)||
      !int(row.bank_payment_kop)||!int(row.row_count)||row.row_count<0||
      !int(row.sales_count)||row.sales_count<0||
      !int(row.returns_count)||row.returns_count<0||
      !nullableInt(row.api_calculated_payment_kop)||
      !timestamp(row.updated_at)||
      !text(row.error_code,75)||
      !/^[a-z0-9_]*$/i.test(row.error_code))
      throw Error('wb_monitor_unverified');
    seen.add(row.report_id);
    counts[row.status]++;
    if(row.status==='complete'){
      if(row.api_calculated_payment_kop!==row.bank_payment_kop)
        throw Error('wb_monitor_complete_inconsistent');
      bankComplete+=row.bank_payment_kop;
      completedOperations+=row.row_count;
    }
    if(['mismatch','conflict','failed'].includes(row.status))bankMismatchCount++;
    return {
      reportId:row.report_id,dateFrom:row.date_from,dateTo:row.date_to,
      reportType:row.report_type,status:row.status,
      bankPaymentKop:row.bank_payment_kop,
      calculatedPaymentKop:row.api_calculated_payment_kop,
      rowCount:row.row_count,sales:row.sales_count,returns:row.returns_count,
      errorCode:row.error_code||null,updatedAt:row.updated_at
    };
  });
  if(!int(bankComplete)||!int(completedOperations))
    throw Error('wb_monitor_unverified');
  if(completedOperations>operationsStored)
    throw Error('wb_monitor_row_counts_inconsistent');

  const health=monitorHealth(runtime,nowMs);
  const queue=counts.pending+counts.paging;
  const warnings=[];
  if(health==='halted')warnings.push('SYNC_HALTED');
  if(health==='delayed')warnings.push('SYNC_DELAYED');
  if(health==='clock_error')warnings.push('SYNC_CLOCK_ERROR');
  if(counts.mismatch)warnings.push('PAYOUT_MISMATCH');
  if(counts.conflict)warnings.push('SOURCE_CONFLICT');
  if(counts.failed)warnings.push('REPORT_FAILED');
  const attention=warnings.length>0?'attention':health==='on_schedule'?'healthy':
    health==='starting_window'?'starting':
    health==='never_started'?'not_started':'outside_window';
  return {
    code:'wb_api_sync_status',source:'WB_FINANCE_API_D1',
    readOnly:true,changedRecords:0,asOfMs:nowMs,
    expectedIntervalMinutes:EXPECTED_INTERVAL_MIN,
    scheduledWindowSamara:'08:00–10:55',
    monitorHealth:health,attention,
    warnings,
    lastRequestMs:runtime.last_request_ms||null,
    lastJobStatus:runtime.last_status,
    lastListingDate:runtime.last_list_day||null,
    lastStateChange:runtime.updated_at||null,
    listOffset:runtime.list_offset,
    reportCount:reports.length,completedCount:counts.complete,
    queuedCount:queue,mismatchCount:counts.mismatch,
    conflictCount:counts.conflict,failedCount:counts.failed,
    statusCounts:counts,
    operationsStored,completedOperations,
    totalBankPaymentKop:bankComplete,
    sumScope:'API_COMPLETED_REPORTS_ONLY_DO_NOT_ADD_XLSX',
    costStatus:'COST_CATALOG_NOT_YET_ATTACHED',
    netProfitStatus:'NOT_CALCULATED',
    reports:reports.sort((a,b)=>
      b.dateTo.localeCompare(a.dateTo)||
      b.reportId.localeCompare(a.reportId))
  };
}
