import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = await readFile(
  new URL("../../functions/api/ozon/reconciliation-core.js", import.meta.url),
  "utf8"
);
const { reconcileOzonDay } = await import(
  `data:text/javascript;base64,${Buffer
    .from(source)
    .toString("base64")}`
);

const manifest = {
  operationDate: "2026-10-28",
  report: {
    name: "synthetic-report.xlsx",
    sha256: "a".repeat(64),
    detailRows: 3
  },
  expectedTotalKopecks: 250,
  expectedPositiveKopecks: 700,
  expectedNegativeKopecks: -450,
  accruals: [
    {
      accrualId: "101",
      operationDate: "2026-10-28",
      unitNumber: "shipment-1",
      category: "POSTING",
      totalKopecks: 500
    },
    {
      accrualId: "102",
      operationDate: "2026-10-28",
      unitNumber: "shipment-1",
      category: "ITEM",
      totalKopecks: -200
    },
    {
      accrualId: "103",
      operationDate: "2026-10-28",
      unitNumber: null,
      category: "NON_ITEM",
      totalKopecks: -50
    }
  ],
  groups: [
    {
      unitNumber: "shipment-1",
      detailRows: 2,
      totalKopecks: 300
    },
    {
      unitNumber: null,
      detailRows: 1,
      totalKopecks: -50
    }
  ]
};

async function createDatabase({ openDiscrepancy = false, beforeBatch } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "0001_ozon_finance_api_sync.sql",
    "0002_ozon_one_shot_gate.sql",
    "0003_ozon_finance_controls.sql"
  ]) {
    const sql = await readFile(
      new URL(`../../migrations/${migration}`, import.meta.url),
      "utf8"
    );
    sqlite.exec(sql);
  }

  for (const row of manifest.accruals) {
    sqlite.prepare(`
      INSERT INTO ozon_api_accruals (
        accrual_id, operation_date, period, accrued_category,
        unit_number, total_kopecks, currency, source, reconciled
      )
      VALUES (?, ?, '2026-10', ?, ?, ?, 'RUB', 'ozon_seller_api', 0)
    `).run(
      row.accrualId,
      row.operationDate,
      row.category,
      row.unitNumber,
      row.totalKopecks
    );
  }
  sqlite.prepare(`
    INSERT INTO ozon_api_sync_state (
      sync_date, source, status, last_id, page_count, record_count,
      page_complete, reconciled, last_started_at, last_completed_at
    )
    VALUES (
      '2026-10-28', 'ozon_seller_api', 'complete', '',
      1, 3, 1, 0, '2026-10-28T00:00:00Z', '2026-10-28T00:01:00Z'
    )
  `).run();
  sqlite.prepare(`
    INSERT INTO ozon_api_sync_runs (
      run_id, source, period_start, period_end, status,
      page_count, record_count, started_at, finished_at
    )
    VALUES (
      'run-1', 'ozon_seller_api', '2026-10-28', '2026-10-28',
      'complete', 1, 3, '2026-10-28T00:00:00Z',
      '2026-10-28T00:01:00Z'
    )
  `).run();

  if (openDiscrepancy) {
    sqlite.prepare(`
      INSERT INTO ozon_api_accrual_discrepancies (
        discrepancy_id, accrual_id, previous_date, previous_category,
        previous_total_kopecks, observed_date, observed_category,
        observed_total_kopecks, previous_components_hash,
        observed_components_hash, status
      )
      VALUES (
        'drift-1', '101', '2026-10-28', 'POSTING', 500,
        '2026-10-28', 'POSTING', 500, ?, ?, 'open'
      )
    `).run("b".repeat(64), "c".repeat(64));
  }

  return {
    sqlite,
    prepare(sql) {
      let values = [];
      const statement = {
        sql,
        values,
        bind(...bound) {
          values = bound;
          statement.values = bound;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        }
      };
      return statement;
    },
    async batch(statements) {
      beforeBatch?.(sqlite);
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map(statement => {
          const output = sqlite
            .prepare(statement.sql)
            .run(...statement.values);
          return {
            success: true,
            meta: { changes: Number(output.changes) }
          };
        });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

test("SQLite migration records net verification but leaves details unverified", async t => {
  const db = await createDatabase();
  t.after(() => db.sqlite.close());

  const result = await reconcileOzonDay(db, manifest);
  const rows = db.sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM ozon_api_accruals
    WHERE reconciled = 1
  `).get();
  const audit = db.sqlite.prepare(`
    SELECT expected_count, actual_count, updated_count,
           expected_total_kopecks, actual_total_kopecks,
           report_positive_kopecks, report_negative_kopecks,
           api_positive_kopecks, api_negative_kopecks,
           net_status, detail_status, detail_reason
    FROM ozon_api_reconciliation_audit
  `).get();
  const auditRows = db.sqlite.prepare(`
    SELECT COUNT(*) AS count,
           MIN(verification_level) AS verification_level,
           MIN(reconciled_before) AS reconciled_before,
           MAX(reconciled_after) AS reconciled_after
    FROM ozon_api_reconciliation_audit_rows
  `).get();
  const state = db.sqlite.prepare(`
    SELECT reconciled FROM ozon_api_sync_state
    WHERE sync_date = '2026-10-28'
  `).get();

  assert.equal(result.status, "net_verified_details_unverified");
  assert.equal(result.netStatus, "verified");
  assert.equal(result.detailStatus, "unverified");
  assert.equal(result.detailReason, "ozon_api_component_mapping_incomplete");
  assert.equal(rows.count, 0);
  assert.equal(audit.expected_count, 3);
  assert.equal(audit.actual_count, 3);
  assert.equal(audit.updated_count, 0);
  assert.equal(audit.expected_total_kopecks, 250);
  assert.equal(audit.actual_total_kopecks, 250);
  assert.equal(audit.report_positive_kopecks, 700);
  assert.equal(audit.report_negative_kopecks, -450);
  assert.equal(audit.api_positive_kopecks, 500);
  assert.equal(audit.api_negative_kopecks, -250);
  assert.equal(audit.net_status, "verified");
  assert.equal(audit.detail_status, "unverified");
  assert.equal(
    audit.detail_reason,
    "ozon_api_component_mapping_incomplete"
  );
  assert.equal(auditRows.count, 3);
  assert.equal(auditRows.verification_level, "net");
  assert.equal(auditRows.reconciled_before, 0);
  assert.equal(auditRows.reconciled_after, 0);
  assert.equal(state.reconciled, 0);
});

test("open discrepancy aborts the D1-style transaction without partial writes", async t => {
  const db = await createDatabase({ openDiscrepancy: true });
  t.after(() => db.sqlite.close());

  await assert.rejects(reconcileOzonDay(db, manifest));
  assert.equal(
    db.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM ozon_api_accruals WHERE reconciled = 1
    `).get().count,
    0
  );
  assert.equal(
    db.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM ozon_api_reconciliation_audit
    `).get().count,
    0
  );
});

test("concurrent row change prevents net audit from being recorded", async t => {
  const db = await createDatabase({
    beforeBatch(sqlite) {
      sqlite.prepare(`
        UPDATE ozon_api_accruals
        SET reconciled = 1
        WHERE accrual_id = '101'
      `).run();
    }
  });
  t.after(() => db.sqlite.close());

  await assert.rejects(reconcileOzonDay(db, manifest));
  const rows = db.sqlite.prepare(`
    SELECT accrual_id, reconciled
    FROM ozon_api_accruals
    ORDER BY accrual_id
  `).all().map(row => ({
    accrual_id: row.accrual_id,
    reconciled: row.reconciled
  }));
  assert.deepEqual(rows, [
    { accrual_id: "101", reconciled: 1 },
    { accrual_id: "102", reconciled: 0 },
    { accrual_id: "103", reconciled: 0 }
  ]);
  assert.equal(
    db.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM ozon_api_reconciliation_audit
    `).get().count,
    0
  );
});
