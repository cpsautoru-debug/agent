import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reconciliationSource = await readFile(
  new URL("./reconciliation.js", import.meta.url),
  "utf8"
);
const { reconcileOzonDay } = await import(
  `data:text/javascript;base64,${Buffer
    .from(reconciliationSource)
    .toString("base64")}`
);

const manifest = {
  operationDate: "2026-10-28",
  report: {
    name: "test-report.xlsx",
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

function accrualRows() {
  return manifest.accruals.map(row => ({
    accrual_id: row.accrualId,
    operation_date: row.operationDate,
    unit_number: row.unitNumber,
    accrued_category: row.category,
    total_kopecks: row.totalKopecks,
    currency: "RUB",
    reconciled: 0
  }));
}

class MockStatement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim().toLowerCase();
    this.values = values;
  }

  bind(...values) {
    return new MockStatement(this.db, this.sql, values);
  }

  async first() {
    if (this.sql.includes("from ozon_api_reconciliation_audit")) {
      return this.db.audit;
    }
    if (this.sql.includes("from ozon_api_sync_state")) {
      return this.db.state;
    }
    if (this.sql.includes("from ozon_api_sync_runs")) {
      return this.db.completeRun;
    }
    if (this.sql.includes("from ozon_api_sync_lock")) {
      return this.db.activeLock;
    }
    throw new Error(`Unexpected first query: ${this.sql}`);
  }

  async all() {
    if (this.sql.includes("from ozon_api_accruals")) {
      return { results: this.db.rows };
    }
    throw new Error(`Unexpected all query: ${this.sql}`);
  }
}

function mockDb(overrides = {}) {
  const db = {
    rows: accrualRows(),
    state: {
      status: "complete",
      page_count: 1,
      record_count: 3,
      page_complete: 1,
      reconciled: 0
    },
    completeRun: { run_id: "run-complete" },
    activeLock: null,
    audit: null,
    batchCalls: 0,
    prepare(sql) {
      return new MockStatement(this, sql);
    },
    async batch(statements) {
      this.batchCalls++;
      const expected = JSON.parse(statements[0].values[0]);
      const report = statements[0].values;
      const positive = this.rows
        .filter(row => row.total_kopecks > 0)
        .reduce((sum, row) => sum + row.total_kopecks, 0);
      const negative = this.rows
        .filter(row => row.total_kopecks < 0)
        .reduce((sum, row) => sum + row.total_kopecks, 0);
      this.audit = {
        source_report: report[4],
        source_sha256: report[5],
        expected_count: report[7],
        expected_total_kopecks: report[8],
        report_positive_kopecks: report[9],
        report_negative_kopecks: report[10],
        actual_count: expected.length,
        actual_total_kopecks: expected.reduce(
          (sum, row) => sum + row.totalKopecks,
          0
        ),
        api_positive_kopecks: positive,
        api_negative_kopecks: negative,
        net_status: "verified",
        detail_status: "unverified",
        detail_reason: report[11],
        updated_count: 0
      };
      return statements.map((statement, index) => ({
        success: true,
        meta: {
          changes: index === 0
            ? 1
            : expected.length
        }
      }));
    },
    ...overrides
  };
  return db;
}

test("verifies net totals and snapshots rows without marking full reconciliation", async () => {
  const db = mockDb();
  const result = await reconcileOzonDay(db, manifest);

  assert.equal(result.status, "net_verified_details_unverified");
  assert.equal(result.netStatus, "verified");
  assert.equal(result.detailStatus, "unverified");
  assert.equal(
    result.detailReason,
    "ozon_api_component_mapping_incomplete"
  );
  assert.equal(result.recordCount, 3);
  assert.equal(db.batchCalls, 1);
  assert.equal(db.rows.filter(row => row.reconciled === 1).length, 0);
  assert.equal(db.audit.report_positive_kopecks, 700);
  assert.equal(db.audit.report_negative_kopecks, -450);
  assert.equal(db.audit.api_positive_kopecks, 500);
  assert.equal(db.audit.api_negative_kopecks, -250);
});

test("refuses an amount mismatch before attempting writes", async () => {
  const db = mockDb({
    rows: accrualRows().map((row, index) => index === 0
      ? { ...row, total_kopecks: row.total_kopecks + 1 }
      : row)
  });

  await assert.rejects(
    reconcileOzonDay(db, manifest),
    { code: "reconciliation_accrual_mismatch" }
  );
  assert.equal(db.batchCalls, 0);
});

test("refuses incomplete coverage and duplicate audit groups", async () => {
  const missing = mockDb({ rows: accrualRows().slice(1) });
  await assert.rejects(
    reconcileOzonDay(missing, manifest),
    { code: "reconciliation_record_count_mismatch" }
  );
  assert.equal(missing.batchCalls, 0);

  const duplicateGroupManifest = {
    ...manifest,
    groups: [...manifest.groups, manifest.groups[0]]
  };
  await assert.rejects(
    reconcileOzonDay(mockDb(), duplicateGroupManifest),
    { code: "duplicate_reconciliation_group" }
  );
});

test("validates source hash, IDs, total, and rejects unsafe paths", async () => {
  const badHash = structuredClone(manifest);
  badHash.report.sha256 = "not-a-hash";
  await assert.rejects(
    reconcileOzonDay(mockDb(), badHash),
    { code: "invalid_reconciliation_manifest" }
  );

  const badId = structuredClone(manifest);
  badId.accruals[0].accrualId = "../101";
  await assert.rejects(
    reconcileOzonDay(mockDb(), badId),
    { code: "invalid_reconciliation_accrual" }
  );

  const badTotal = structuredClone(manifest);
  badTotal.expectedTotalKopecks++;
  badTotal.expectedPositiveKopecks++;
  await assert.rejects(
    reconcileOzonDay(mockDb(), badTotal),
    { code: "reconciliation_control_total_mismatch" }
  );

  const unsafePath = structuredClone(manifest);
  unsafePath.report.name = "../report.xlsx";
  await assert.rejects(
    reconcileOzonDay(mockDb(), unsafePath),
    { code: "invalid_reconciliation_manifest" }
  );
});

test("same net-verified report is an idempotent no-op", async () => {
  const db = mockDb({
    audit: {
      source_report: manifest.report.name,
      source_sha256: manifest.report.sha256.toUpperCase(),
      expected_count: 3,
      expected_total_kopecks: 250,
      report_positive_kopecks: 700,
      report_negative_kopecks: -450,
      actual_count: 3,
      actual_total_kopecks: 250,
      api_positive_kopecks: 500,
      api_negative_kopecks: -250,
      net_status: "verified",
      detail_status: "unverified",
      detail_reason: "ozon_api_component_mapping_incomplete",
      updated_count: 0
    }
  });
  const result = await reconcileOzonDay(db, manifest);

  assert.equal(result.status, "already_net_verified");
  assert.equal(result.netStatus, "verified");
  assert.equal(result.detailStatus, "unverified");
  assert.equal(db.batchCalls, 0);
});
