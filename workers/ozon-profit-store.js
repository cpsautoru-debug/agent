import { validateProfitDocument, monthBounds } from '../functions/api/ozon/profit-model.js';

export const TEST_PROFIT_DATABASE_ID = 'ce9dd331-929d-4c3e-9073-368de3346bc9';
export async function assertProfitTarget(db, target) {
  if (!db || target !== TEST_PROFIT_DATABASE_ID) throw new Error('profit_target_mismatch');
  const marker = await db.prepare('SELECT database_id FROM ozon_profit_target WHERE singleton = 1').first();
  if (marker?.database_id !== TEST_PROFIT_DATABASE_ID) throw new Error('profit_target_mismatch');
}
function validKey(key) {
  if (key === 'costs' || key === 'expenses') return key;
  const match = /^(month|tax):(\d{4}-\d{2})$/.exec(key || '');
  if (!match) throw new Error('invalid_profit_key');
  monthBounds(match[2]); return key;
}
export async function getProfitDocument(db, target, key) {
  validKey(key); await assertProfitTarget(db,target);
  const row = await db.prepare('SELECT payload_json, version FROM ozon_profit_state WHERE document_key = ?').bind(key).first();
  return {key,value:row ? JSON.parse(row.payload_json) : null,version:row?.version || 0};
}
export async function getProfitDocuments(db,target,month) {
  monthBounds(month); await assertProfitTarget(db,target);
  const keys=['costs','expenses',`month:${month}`,`tax:${month}`];
  const rows = await db.prepare('SELECT document_key,payload_json,version FROM ozon_profit_state WHERE document_key IN (?,?,?,?)').bind(...keys).all();
  const names=['costs','expenses','month','tax']; const configuration={},versions={};
  for(let i=0;i<keys.length;i++) {const row=(rows.results||[]).find(r=>r.document_key===keys[i]); configuration[names[i]]=row?JSON.parse(row.payload_json):null; versions[names[i]]=row?.version||0;}
  const audit=await db.prepare(`SELECT change_id,document_key,version,actor,created_at FROM ozon_profit_audit WHERE document_key IN (?,?,?,?) ORDER BY created_at DESC,version DESC LIMIT 50`).bind(...keys).all();
  return {target:TEST_PROFIT_DATABASE_ID,configuration,versions,audit:audit.results||[]};
}
export async function confirmProfitDocument(db,target,{key,value,version,actor,changeId}) {
  validKey(key); const normalized=validateProfitDocument(key,value);
  if (!Number.isSafeInteger(version)||version<0||typeof actor!=='string'||!actor||actor.length>200||typeof changeId!=='string'||!changeId||changeId.length>100) throw new Error('invalid_profit_change');
  await assertProfitTarget(db,target);
  const payload=JSON.stringify(normalized);
  if(new TextEncoder().encode(payload).length>1500000) throw new Error('profit_payload_too_large');
  // One atomic statement: CAS and audit trigger either both commit or both roll back.
  const result = version===0
    ? await db.prepare(`INSERT INTO ozon_profit_state(document_key,payload_json,version,actor,change_id) VALUES(?,?,1,?,?) ON CONFLICT(document_key) DO NOTHING RETURNING version`).bind(key,payload,actor,changeId).first()
    : await db.prepare(`UPDATE ozon_profit_state SET payload_json=?,version=version+1,actor=?,change_id=?,updated_at=CURRENT_TIMESTAMP WHERE document_key=? AND version=? RETURNING version`).bind(payload,actor,changeId,key,version).first();
  if(result?.version!==version+1) throw new Error('profit_version_conflict');
  return {status:'saved',version:version+1,target:TEST_PROFIT_DATABASE_ID};
}
