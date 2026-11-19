// Immutable real-XLSX previews, separate from synthetic DEMO snapshots.
export const PILOT_REPORT_ID = '865265818';
export async function digest(value) {
 const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function readSavedReport(db,accountId) {
 const row=await db.prepare('SELECT source, fingerprint, snapshot_json, snapshot_hash FROM wb_saved_xlsx_reports WHERE account_id = ? AND report_id = ? LIMIT 1').bind(accountId,PILOT_REPORT_ID).first();
 if(!row)return null;
 if(row.source!=='USER_SUPPLIED_WB_XLSX'||await digest(row.snapshot_json)!==row.snapshot_hash)throw Error('invalid_snapshot');
 const snapshot=JSON.parse(row.snapshot_json), p=snapshot?.preview;
 if(snapshot.source!==row.source||snapshot.reportId!==PILOT_REPORT_ID||p?.reportId!==PILOT_REPORT_ID||p?.source!=='XLSX_WITH_PRIVATE_SKU_CATALOG'||p?.kind!=='xlsx_profit_preview'||p?.persisted!==false||p?.readOnly!==true||p?.dataVerified!==false||p?.profitStatus!=='UNVERIFIED'||p?.wbPayoutReconciliation!=='MATCHED_MANUAL_TARGET')throw Error('invalid_snapshot');
 return {snapshot,fingerprint:row.fingerprint};
}
export async function saveReport(db,accountId,preview,fingerprint,owner) {
 const snapshot={source:'USER_SUPPLIED_WB_XLSX',reportId:PILOT_REPORT_ID,periodStart:'2026-10-01',periodEnd:'2026-10-04',savedAt:new Date().toISOString(),preview};
 const text=JSON.stringify(snapshot),hash=await digest(text);
 const result=await db.prepare('INSERT INTO wb_saved_xlsx_reports (account_id, report_id, source, fingerprint, snapshot_json, snapshot_hash, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, report_id) DO NOTHING').bind(accountId,PILOT_REPORT_ID,snapshot.source,fingerprint,text,hash,owner).run();
 const stored=await readSavedReport(db,accountId);
 if(!stored||stored.fingerprint!==fingerprint)return {conflict:true};
 return {snapshot:stored.snapshot,duplicate:result.meta.changes===0};
}
