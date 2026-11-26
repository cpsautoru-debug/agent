// Scope evidence for a shared warehouse allocation. A complete paginated
// response within a date window is NOT proof of every still-open obligation.
const REQUIRED=['ozon','wb','yandex','manual'];
const KNOWN={
 ozon:new Set(['ALL_OPEN_OZON_FBS_VERIFIED']),
 wb:new Set(['ALL_OPEN_WB_FBS_VERIFIED']),
 yandex:new Set(['ALL_OPEN_YANDEX_BOTH_CAMPAIGNS_VERIFIED']),
 manual:new Set(['ALL_OPEN_MANUAL_CUSTOMERORDERS_VERIFIED'])
};
const SCOPED={
 ozon:'FBS_AWAITING_PACKAGING_LAST_7_DAYS_COMPLETE',
 wb:'WB_NEW_FBS_ORDERS_API_SNAPSHOT',
 yandex:'BOTH_CAMPAIGNS_LAST_30_DAYS_COMPLETE',
 manual:'MANUAL_MARKED_CUSTOMERORDERS_COMPLETE'
};
export function assessMarketplaceCoverage(syncRows,{now=Date.now(),maxAgeMs=30*60*1000}={}){
 if(!Array.isArray(syncRows)||!Number.isFinite(now)||maxAgeMs<=0)
  return {complete:false,reason:'source_evidence_invalid',sources:[]};
 const bySource=new Map(syncRows.map(row=>[row?.source,row]));
 const sources=REQUIRED.map(source=>{
  const row=bySource.get(source);
  const checked=Date.parse(row?.last_success_at||'');
  const fresh=Number.isFinite(checked)&&checked<=now+300000&&now-checked>=0&&now-checked<=maxAgeMs;
  const coverage=typeof row?.coverage==='string'?row.coverage:'';
  // Full open-order scope must be explicitly certified by the importer,
  // not inferred from an empty list or successful date-scoped pagination.
  const full=KNOWN[source].has(coverage);
  const valid=Number.isSafeInteger(row?.rows_seen)&&row.rows_seen>=0;
  return {source,ready:fresh&&full&&valid,
   reason:!row?'source_missing':!fresh?'source_snapshot_stale':
    !valid?'source_count_unverified':full?'all_open_verified':
    coverage===SCOPED[source]?'time_or_status_scoped_only':'open_obligations_unverified'};
 });
 return {complete:sources.every(x=>x.ready),reason:sources.every(x=>x.ready)?
  null:'marketplace_coverage_unverified',sources};
}
