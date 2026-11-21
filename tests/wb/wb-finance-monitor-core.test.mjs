import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT,REPORT_LIMIT,monitorHealth,samaraClock,
  summarizeWbFinance
} from '../../web/office/wb-finance-monitor-core.mjs';
const NOW=Date.UTC(2026,10,21,5,26); // 09:26 in Samara
const runtime={
  last_status:'report_complete',last_request_ms:NOW-60_000,
  last_list_day:'2026-11-21',list_offset:0,updated_at:'2026-11-21 05:25:06'
};
const report=(n,status)=>({
  report_id:String(865265800+n),
  date_from:'2026-10-01',date_to:'2026-10-07',
  report_type:1,bank_payment_kop:1000+n,
  status,row_count:status==='complete'?112:0,
  sales_count:status==='complete'?90:0,
  returns_count:status==='complete'?4:0,
  api_calculated_payment_kop:status==='complete'?1000+n:null,
  error_code:'',updated_at:'2026-11-21 05:25:06'
});
const rows=[
  ...Array.from({length:9},(_,i)=>report(i,'complete')),
  ...Array.from({length:7},(_,i)=>report(i+9,'pending'))
];
test('2026-11-21 WB D1 snapshot: 9 complete, 7 pending, 1008 operations',()=>{
  const out=summarizeWbFinance(runtime,rows,1008,NOW);
  assert.equal(ACCOUNT,'4271851');
  assert.equal(REPORT_LIMIT,300);
  assert.equal(out.source,'WB_FINANCE_API_D1');
  assert.equal(out.code,'wb_api_sync_status');
  assert.equal(out.monitorHealth,'on_schedule');
  assert.equal(out.attention,'healthy');
  assert.equal(out.reportCount,16);
  assert.equal(out.completedCount,9);
  assert.equal(out.queuedCount,7);
  assert.equal(out.operationsStored,1008);
  assert.equal(out.completedOperations,1008);
  assert.equal(out.statusCounts.pending,7);
  assert.equal(out.mismatchCount,0);
  assert.equal(out.conflictCount,0);
  assert.equal(out.warnings.length,0);
  assert.equal(out.sumScope,'API_COMPLETED_REPORTS_ONLY_DO_NOT_ADD_XLSX');
  assert.equal(out.costStatus,'COST_CATALOG_NOT_YET_ATTACHED');
  assert.equal(out.netProfitStatus,'NOT_CALCULATED');
  assert.equal(out.readOnly,true);
  assert.equal(out.changedRecords,0);
  assert.equal(out.totalBankPaymentKop,rows.slice(0,9).reduce((n,r)=>n+r.bank_payment_kop,0));
  assert.equal(out.reports.length,16);
  assert.ok(out.reports.every(x=>!Object.hasOwn(x,'source_hash')));
});
test('Samara timezone detects morning Cron stalls without calling overnight a failure',()=>{
  assert.equal(samaraClock(NOW).hour,9);
  assert.equal(monitorHealth(runtime,NOW),'on_schedule');
  assert.equal(monitorHealth({...runtime,last_request_ms:NOW-19*60_000},NOW),'on_schedule');
  assert.equal(monitorHealth({...runtime,last_request_ms:NOW-21*60_000},NOW),'delayed');
  const before=Date.UTC(2026,10,21,4,10); // 08:10 Samara
  assert.equal(monitorHealth({...runtime,last_request_ms:0},before),'starting_window');
  const after=Date.UTC(2026,10,21,4,30); // 08:30
  assert.equal(monitorHealth({...runtime,last_request_ms:0},after),'delayed');
  assert.equal(monitorHealth({...runtime,last_request_ms:0},NOW),'delayed');
  const evening=Date.UTC(2026,10,21,13,0);
  assert.equal(monitorHealth(runtime,evening),'outside_window');
  assert.equal(monitorHealth({...runtime,last_request_ms:0},evening),'never_started');
  assert.equal(monitorHealth({...runtime,last_status:'halted_report_rate_limited'},evening),'halted');
  assert.equal(monitorHealth({...runtime,last_request_ms:NOW+10*60_000},NOW),'clock_error');
});
test('mismatch, conflict, failed and halted states all create explicit warnings',()=>{
  const changed=[
    {...report(0,'mismatch'),api_calculated_payment_kop:820,
      error_code:'payout_needs_review'},
    {...report(1,'conflict'),error_code:'api_operation_changed'},
    {...report(2,'failed'),error_code:'source_unavailable'},
    {...report(3,'pending')}
  ];
  const result=summarizeWbFinance({...runtime,
    last_status:'halted_report_rate_limited'},changed,0,NOW);
  assert.equal(result.monitorHealth,'halted');
  assert.equal(result.attention,'attention');
  assert.deepEqual(result.warnings,[
    'SYNC_HALTED','PAYOUT_MISMATCH','SOURCE_CONFLICT','REPORT_FAILED'
  ]);
  assert.equal(result.queuedCount,1);
  assert.equal(result.totalBankPaymentKop,0);
  assert.equal(result.reports.find(x=>x.status==='mismatch').calculatedPaymentKop,820);
  const stale=summarizeWbFinance({...runtime,last_request_ms:NOW-90*60_000},rows,1008,NOW);
  assert.deepEqual(stale.warnings,['SYNC_DELAYED']);
  assert.equal(stale.attention,'attention');
});
test('invalid or inconsistent D1 rows fail closed, never turn into zero payouts',()=>{
  const valid=report(0,'complete');
  const bad=[
    [{...valid,report_id:'123 OR 1=1'}],
    [valid,valid],
    [{...valid,bank_payment_kop:Infinity}],
    [{...valid,api_calculated_payment_kop:12}],
    [{...valid,status:'error_we_do_not_know'}],
    [{...valid,date_from:'2026-12-12',date_to:'2026-11-11'}],
    [{...valid,error_code:'<private>'}],
    [{...valid,updated_at:'some token'}]
  ];
  for(const group of bad){
    assert.throws(()=>summarizeWbFinance(runtime,group,112,NOW));
  }
  assert.throws(()=>summarizeWbFinance(runtime,[valid],0,NOW));
  assert.throws(()=>summarizeWbFinance(runtime,
    Array.from({length:301},(_,i)=>report(i,'pending')),0,NOW));
  assert.throws(()=>summarizeWbFinance({...runtime,last_request_ms:'bad'},rows,1008,NOW));
  assert.throws(()=>summarizeWbFinance({...runtime,list_offset:-1},rows,1008,NOW));
});
test('all values from completed reports are counted once; live paging not overclaimed',()=>{
  const small=[report(0,'complete'),{...report(1,'paging'),
    row_count:0,api_calculated_payment_kop:null}];
  const out=summarizeWbFinance(runtime,small,113,NOW);
  assert.equal(out.completedOperations,112);
  assert.equal(out.operationsStored,113);
  assert.equal(out.queuedCount,1);
  assert.equal(out.completedCount,1);
  assert.equal(out.totalBankPaymentKop,1000);
});
