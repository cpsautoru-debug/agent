// Immutable owner-supplied XLSX snapshots; no finance calculations here.
export const PILOT_REPORT_ID='865265818';
export const validReportId=id=>typeof id==='string'&&/^\d{1,20}$/.test(id);
export function validPeriod(start,end){return /^2026-10-(0[1-9]|[12]\d|3[01])$/.test(start||'')&&/^2026-10-(0[1-9]|[12]\d|3[01])$/.test(end||'')&&start<=end}
export async function digest(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')}
async function decode(row){
 if(row.source!=='USER_SUPPLIED_WB_XLSX'||await digest(row.snapshot_json)!==row.snapshot_hash)throw Error('invalid_snapshot');
 const snapshot=JSON.parse(row.snapshot_json),p=snapshot?.preview;
 if(!validReportId(row.report_id)||snapshot.source!==row.source||snapshot.reportId!==row.report_id||p?.reportId!==row.report_id||!validPeriod(snapshot.periodStart,snapshot.periodEnd)||p?.source!=='XLSX_WITH_PRIVATE_SKU_CATALOG'||p?.kind!=='xlsx_profit_preview'||p?.persisted!==false||p?.readOnly!==true||p?.dataVerified!==false||p?.profitStatus!=='UNVERIFIED'||p?.wbPayoutReconciliation!=='MATCHED_MANUAL_TARGET')throw Error('invalid_snapshot');
 return {snapshot,fingerprint:row.fingerprint};
}
export async function readSavedReport(db,accountId,reportId=PILOT_REPORT_ID){
 if(!validReportId(reportId))throw Error('invalid_report_id');
 const row=await db.prepare('SELECT report_id, source, fingerprint, snapshot_json, snapshot_hash FROM wb_saved_xlsx_reports WHERE account_id = ? AND report_id = ? LIMIT 1').bind(accountId,reportId).first();
 return row?decode(row):null;
}
export async function listSavedReports(db,accountId){
 const result=await db.prepare('SELECT report_id, source, fingerprint, snapshot_json, snapshot_hash FROM wb_saved_xlsx_reports WHERE account_id = ? ORDER BY report_id LIMIT 101').bind(accountId).all();
 if(result.results.length>100)throw Error('report_list_limit');
 const rows=await Promise.all(result.results.map(decode));
 return rows.map(({snapshot:s})=>({reportId:s.reportId,periodStart:s.periodStart,periodEnd:s.periodEnd,periodSource:s.periodSource||'OWNER_SPECIFIED',payoutKop:s.preview.estimate.payoutKop,cogsKop:s.preview.estimate.cogsKop,sales:s.preview.sales,returns:s.preview.returns,profitStatus:s.preview.profitStatus,wbPayoutReconciliation:s.preview.wbPayoutReconciliation,source:s.source}));
}
export async function saveReport(db,accountId,preview,fingerprint,owner,period={start:'2026-10-01',end:'2026-10-04'}){
 if(!validReportId(preview.reportId)||!validPeriod(period.start,period.end))throw Error('invalid_report_period');
 const snapshot={source:'USER_SUPPLIED_WB_XLSX',reportId:preview.reportId,periodStart:period.start,periodEnd:period.end,savedAt:new Date().toISOString(),preview};
 if(preview.reportId!==PILOT_REPORT_ID)snapshot.periodSource='OWNER_SPECIFIED';
 const text=JSON.stringify(snapshot),hash=await digest(text);
 const result=await db.prepare('INSERT INTO wb_saved_xlsx_reports (account_id, report_id, source, fingerprint, snapshot_json, snapshot_hash, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, report_id) DO NOTHING').bind(accountId,preview.reportId,snapshot.source,fingerprint,text,hash,owner).run();
 const stored=await readSavedReport(db,accountId,preview.reportId);
 if(!stored||stored.fingerprint!==fingerprint)return {conflict:true};
 return {snapshot:stored.snapshot,duplicate:result.meta.changes===0};
}
