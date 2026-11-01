const SOURCE = "ozon_seller_api";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const ID_PATTERN = /^[0-9]{1,30}$/;
const MAX_ACCRUALS = 500;
const MAX_GROUPS = 500;

export class ReconciliationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReconciliationError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function validateManifest(manifest) {
  if (
    !isRecord(manifest) ||
    !validDate(manifest.operationDate) ||
    !isRecord(manifest.report) ||
    typeof manifest.report.name !== "string" ||
    manifest.report.name.length < 1 ||
    manifest.report.name.length > 200 ||
    /[\\/]/.test(manifest.report.name) ||
    !HASH_PATTERN.test(manifest.report.sha256) ||
    !Array.isArray(manifest.accruals) ||
    manifest.accruals.length < 1 ||
    manifest.accruals.length > MAX_ACCRUALS ||
    !Array.isArray(manifest.groups) ||
    manifest.groups.length < 1 ||
    manifest.groups.length > MAX_GROUPS ||
    !Number.isSafeInteger(manifest.expectedTotalKopecks) ||
    !Number.isSafeInteger(manifest.expectedPositiveKopecks) ||
    manifest.expectedPositiveKopecks < 0 ||
    !Number.isSafeInteger(manifest.expectedNegativeKopecks) ||
    manifest.expectedNegativeKopecks > 0 ||
    !Number.isSafeInteger(
      manifest.expectedPositiveKopecks +
        manifest.expectedNegativeKopecks
    ) ||
    manifest.expectedPositiveKopecks +
      manifest.expectedNegativeKopecks !==
        manifest.expectedTotalKopecks
  ) {
    throw new ReconciliationError("invalid_reconciliation_manifest");
  }

  const ids = new Set();
  for (const row of manifest.accruals) {
    if (
      !isRecord(row) ||
      typeof row.accrualId !== "string" ||
      !ID_PATTERN.test(row.accrualId) ||
      ids.has(row.accrualId) ||
      row.operationDate !== manifest.operationDate ||
      (
        row.unitNumber !== null &&
        typeof row.unitNumber !== "string"
      ) ||
      typeof row.category !== "string" ||
      row.category.length < 1 ||
      row.category.length > 100 ||
      !Number.isSafeInteger(row.totalKopecks)
    ) {
      throw new ReconciliationError("invalid_reconciliation_accrual");
    }
    ids.add(row.accrualId);
  }

  const groupKeys = new Set();
  let detailRows = 0;
  let total = 0;
  for (const group of manifest.groups) {
    if (
      !isRecord(group) ||
      (
        group.unitNumber !== null &&
        typeof group.unitNumber !== "string"
      ) ||
      !Number.isSafeInteger(group.detailRows) ||
      group.detailRows < 1 ||
      !Number.isSafeInteger(group.totalKopecks)
    ) {
      throw new ReconciliationError("invalid_reconciliation_group");
    }

    const key = group.unitNumber === null
      ? "null"
      : `value:${group.unitNumber}`;
    if (groupKeys.has(key)) {
      throw new ReconciliationError("duplicate_reconciliation_group");
    }
    groupKeys.add(key);
    detailRows += group.detailRows;
    total += group.totalKopecks;
  }

  if (
    detailRows !== manifest.report.detailRows ||
    !Number.isSafeInteger(detailRows) ||
    total !== manifest.expectedTotalKopecks ||
    !Number.isSafeInteger(total)
  ) {
    throw new ReconciliationError("reconciliation_control_total_mismatch");
  }

  return {
    operationDate: manifest.operationDate,
    report: {
      name: manifest.report.name,
      sha256: manifest.report.sha256.toUpperCase(),
      detailRows: manifest.report.detailRows
    },
    expectedTotalKopecks: manifest.expectedTotalKopecks,
    reportPositiveKopecks: manifest.expectedPositiveKopecks,
    reportNegativeKopecks: manifest.expectedNegativeKopecks,
    accruals: manifest.accruals,
    groups: manifest.groups,
    ids: [...ids]
  };
}

function sum(values, field) {
  return values.reduce((total, value) => total + value[field], 0);
}

function compareRows(actualRows, manifest) {
  if (actualRows.length !== manifest.accruals.length) {
    throw new ReconciliationError("reconciliation_record_count_mismatch");
  }

  const actualById = new Map(
    actualRows.map(row => [row.accrual_id, row])
  );
  const expectedById = new Map(
    manifest.accruals.map(row => [row.accrualId, row])
  );

  for (const expected of manifest.accruals) {
    const actual = actualById.get(expected.accrualId);
    if (
      !actual ||
      actual.operation_date !== expected.operationDate ||
      actual.unit_number !== expected.unitNumber ||
      actual.accrued_category !== expected.category ||
      actual.total_kopecks !== expected.totalKopecks ||
      actual.currency !== "RUB" ||
      actual.reconciled !== 0
    ) {
      throw new ReconciliationError("reconciliation_accrual_mismatch");
    }
  }

  const groups = new Map();
  for (const row of actualRows) {
    const key = row.unit_number === null
      ? "null"
      : `value:${row.unit_number}`;
    const group = groups.get(key) || {
      unitNumber: row.unit_number,
      totalKopecks: 0,
      accrualIds: []
    };
    group.totalKopecks += row.total_kopecks;
    group.accrualIds.push(row.accrual_id);
    groups.set(key, group);
  }

  for (const expected of manifest.groups) {
    const key = expected.unitNumber === null
      ? "null"
      : `value:${expected.unitNumber}`;
    const actual = groups.get(key);
    if (
      !actual ||
      actual.totalKopecks !== expected.totalKopecks ||
      !Number.isSafeInteger(actual.totalKopecks)
    ) {
      throw new ReconciliationError("reconciliation_group_mismatch");
    }
  }

  if (
    groups.size !== manifest.groups.length ||
    actualRows.some(row => !expectedById.has(row.accrual_id)) ||
    sum(actualRows.map(row => ({
      totalKopecks: row.total_kopecks
    })), "totalKopecks") !== manifest.expectedTotalKopecks
  ) {
    throw new ReconciliationError("reconciliation_control_total_mismatch");
  }
}

export async function reconcileOzonDay(db, input) {
  if (!db) throw new ReconciliationError("database_unavailable");
  const manifest = validateManifest(input);
  const auditId = `ozon:${manifest.operationDate}:${manifest.report.sha256}`;
  const detailReason = "ozon_api_component_mapping_incomplete";

  const priorAudit = await db.prepare(`
    SELECT audit_id, source_report, source_sha256, expected_count,
           expected_total_kopecks, report_positive_kopecks,
           report_negative_kopecks, actual_count, actual_total_kopecks,
           api_positive_kopecks, api_negative_kopecks, net_status,
           detail_status, detail_reason, updated_count
    FROM ozon_api_reconciliation_audit
    WHERE audit_id = ?
  `).bind(auditId).first();

  if (priorAudit) {
    if (
      priorAudit.source_report !== manifest.report.name ||
      priorAudit.source_sha256 !== manifest.report.sha256 ||
      priorAudit.expected_count !== manifest.accruals.length ||
      priorAudit.expected_total_kopecks !==
        manifest.expectedTotalKopecks ||
      priorAudit.report_positive_kopecks !==
        manifest.reportPositiveKopecks ||
      priorAudit.report_negative_kopecks !==
        manifest.reportNegativeKopecks ||
      priorAudit.actual_count !== manifest.accruals.length ||
      priorAudit.actual_total_kopecks !==
        manifest.expectedTotalKopecks ||
      priorAudit.net_status !== "verified" ||
      priorAudit.detail_status !== "unverified" ||
      priorAudit.detail_reason !== detailReason ||
      priorAudit.updated_count !== 0
    ) {
      throw new ReconciliationError("reconciliation_audit_conflict");
    }

    return {
      status: "already_net_verified",
      auditId,
      recordCount: manifest.accruals.length,
      totalKopecks: manifest.expectedTotalKopecks,
      netStatus: "verified",
      detailStatus: "unverified",
      detailReason
    };
  }

  const rowsResult = await db.prepare(`
    SELECT accrual_id, operation_date, unit_number, accrued_category,
           total_kopecks, currency, reconciled
    FROM ozon_api_accruals
    WHERE operation_date = ?
      AND source = ?
    ORDER BY accrual_id
  `).bind(manifest.operationDate, SOURCE).all();
  const actualRows = rowsResult.results || [];
  compareRows(actualRows, manifest);

  const state = await db.prepare(`
    SELECT status, page_count, record_count, page_complete, reconciled
    FROM ozon_api_sync_state
    WHERE sync_date = ? AND source = ?
  `).bind(manifest.operationDate, SOURCE).first();
  if (
    !state ||
    state.status !== "complete" ||
    state.page_complete !== 1 ||
    state.record_count !== actualRows.length ||
    state.reconciled !== 0
  ) {
    throw new ReconciliationError("reconciliation_sync_state_mismatch");
  }

  const completeRun = await db.prepare(`
    SELECT run_id
    FROM ozon_api_sync_runs
    WHERE period_start = ?
      AND period_end = ?
      AND source = ?
      AND status = 'complete'
      AND record_count = ?
      AND finished_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).bind(
    manifest.operationDate,
    manifest.operationDate,
    SOURCE,
    actualRows.length
  ).first();
  if (!completeRun) {
    throw new ReconciliationError("reconciliation_complete_run_missing");
  }

  const activeLock = await db.prepare(`
    SELECT 1 AS active
    FROM ozon_api_sync_lock
    WHERE lock_id = 1
      AND lock_token IS NOT NULL
      AND datetime(locked_until) > CURRENT_TIMESTAMP
  `).first();
  if (activeLock) {
    throw new ReconciliationError("reconciliation_sync_in_progress");
  }

  const insertAudit = db.prepare(`
    WITH expected AS (
      SELECT
        json_extract(value, '$.accrualId') AS accrual_id,
        json_extract(value, '$.operationDate') AS operation_date,
        json_extract(value, '$.unitNumber') AS unit_number,
        json_extract(value, '$.category') AS accrued_category,
        json_extract(value, '$.totalKopecks') AS total_kopecks
      FROM json_each(?)
    )
    INSERT INTO ozon_api_reconciliation_audit (
      audit_id, operation_date, source, source_report, source_sha256,
      method, expected_count, expected_total_kopecks,
      report_positive_kopecks, report_negative_kopecks,
      actual_count, actual_total_kopecks, api_positive_kopecks,
      api_negative_kopecks, net_status, detail_status, detail_reason,
      updated_count
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      COUNT(*), COALESCE(SUM(total_kopecks), 0),
      COALESCE(SUM(CASE WHEN total_kopecks > 0
        THEN total_kopecks ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN total_kopecks < 0
        THEN total_kopecks ELSE 0 END), 0),
      'verified', 'unverified', ?, 0
    FROM ozon_api_accruals
    WHERE operation_date = ? AND source = ?
    HAVING COUNT(*) = ?
      AND COALESCE(SUM(total_kopecks), 0) = ?
      AND NOT EXISTS (
        SELECT 1
        FROM expected
        LEFT JOIN ozon_api_accruals AS current
          ON current.accrual_id = expected.accrual_id
        WHERE current.accrual_id IS NULL
          OR current.operation_date != expected.operation_date
          OR current.unit_number IS NOT expected.unit_number
          OR current.accrued_category != expected.accrued_category
          OR current.total_kopecks != expected.total_kopecks
          OR current.currency != 'RUB'
          OR current.reconciled != 0
      )
      AND (SELECT COUNT(*) FROM expected) = ?
      AND EXISTS (
        SELECT 1 FROM ozon_api_sync_state
        WHERE sync_date = ? AND source = ?
          AND status = 'complete' AND page_complete = 1
          AND reconciled = 0 AND record_count = ?
      )
      AND EXISTS (
        SELECT 1 FROM ozon_api_sync_runs
        WHERE period_start = ? AND period_end = ? AND source = ?
          AND status = 'complete' AND record_count = ?
          AND finished_at IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM ozon_api_sync_lock
        WHERE lock_id = 1 AND lock_token IS NOT NULL
          AND datetime(locked_until) > CURRENT_TIMESTAMP
      )
      AND NOT EXISTS (
        SELECT 1 FROM ozon_api_accrual_discrepancies
        JOIN ozon_api_accruals USING (accrual_id)
        WHERE operation_date = ? AND source = ? AND status = 'open'
      )
      AND NOT EXISTS (
        SELECT 1 FROM ozon_api_reconciliation_audit
        WHERE audit_id = ?
      )
  `).bind(
    JSON.stringify(manifest.accruals),
    auditId,
    manifest.operationDate,
    SOURCE,
    manifest.report.name,
    manifest.report.sha256,
    "net_by_unit_number_date_and_total",
    manifest.accruals.length,
    manifest.expectedTotalKopecks,
    manifest.reportPositiveKopecks,
    manifest.reportNegativeKopecks,
    detailReason,
    manifest.operationDate,
    SOURCE,
    manifest.accruals.length,
    manifest.expectedTotalKopecks,
    manifest.accruals.length,
    manifest.operationDate,
    SOURCE,
    manifest.accruals.length,
    manifest.operationDate,
    manifest.operationDate,
    SOURCE,
    manifest.accruals.length,
    manifest.operationDate,
    SOURCE,
    auditId
  );

  const insertAuditRows = db.prepare(`
    INSERT INTO ozon_api_reconciliation_audit_rows (
      audit_id, accrual_id, operation_date, unit_number,
      accrued_category, total_kopecks, verification_level,
      reconciled_before, reconciled_after
    )
    SELECT ?, accrual_id, operation_date, unit_number,
      accrued_category, total_kopecks, 'net', reconciled, reconciled
    FROM ozon_api_accruals
    WHERE operation_date = ? AND source = ? AND reconciled = 0
      AND EXISTS (
        SELECT 1 FROM ozon_api_reconciliation_audit WHERE audit_id = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM ozon_api_reconciliation_audit_rows
        WHERE audit_id = ? AND accrual_id = ozon_api_accruals.accrual_id
      )
  `).bind(
    auditId,
    manifest.operationDate,
    SOURCE,
    auditId,
    auditId
  );

  const result = await db.batch([insertAudit, insertAuditRows]);
  const auditCount = Number(result[0]?.meta?.changes || 0);
  const auditRowCount = Number(result[1]?.meta?.changes || 0);
  if (
    auditCount !== 1 ||
    auditRowCount !== manifest.accruals.length
  ) {
    throw new ReconciliationError("reconciliation_transaction_incomplete");
  }

  return {
    status: "net_verified_details_unverified",
    auditId,
    recordCount: auditRowCount,
    totalKopecks: manifest.expectedTotalKopecks,
    netStatus: "verified",
    detailStatus: "unverified",
    detailReason
  };
}
