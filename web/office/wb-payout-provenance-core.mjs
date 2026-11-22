// A payout check in a WB report is not evidence of money reaching a bank.
// The existing endpoint aggregates ALL completed reports, not a calendar month.
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function explainWbPayoutEvidence(data){
  if(data?.code!=='wb_unit_economics_preview'||
    data.source!=='WB_FINANCE_API_D1'||
    data.scope!=='ALL_COMPLETED_WB_REPORTS_NOT_CALENDAR_MONTH'||
    data.readOnly!==true||data.changedRecords!==0||
    data.netProfitKopecks!==null||data.profitVerified!==false||
    !integer(data.completeReports)||!integer(data.pendingReports)||
    !integer(data.mismatchedReports)||
    !Number.isSafeInteger(data.bankPayoutKopecks)||
    !integer(data.completedOperations)||
    data.reconciliation!=='matched')
    throw Error('invalid_wb_payout_evidence');
  return {
    readOnly:true,calendarMonthVerified:false,bankStatementVerified:false,
    reportCount:data.completeReports,pendingCount:data.pendingReports,
    mismatchedCount:data.mismatchedReports,
    operationCount:data.completedOperations,
    reportedPayoutKopecks:data.bankPayoutKopecks,
    label:data.mismatchedReports?'Внутренняя сверка завершённых отчётов WB: совпадает; есть другие отчёты с расхождениями':'Внутренняя сверка отчётов WB: совпадает',
    note:'Сумма «К перечислению» совпала только для завершённых отчётов WB. '+
      (data.mismatchedReports?'Отчётов со статусом mismatch: '+data.mismatchedReports+'; они исключены из этой суммы. ':'')+
      'Это не банковская выписка, не сверка календарного месяца и не чистая прибыль.'
  };
}
