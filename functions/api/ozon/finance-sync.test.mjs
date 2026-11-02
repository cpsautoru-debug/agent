import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./finance-sync.js", import.meta.url),
  "utf8"
);
const moduleUrl = `data:text/javascript;base64,${Buffer
  .from(source)
  .toString("base64")}`;
const {
  getOzonDateWindow,
  moneyToKopecks,
  syncOzonFinance
} = await import(moduleUrl);
const sessionSource = await readFile(
  new URL("../auth/session.js", import.meta.url),
  "utf8"
);
const sessionModuleUrl = `data:text/javascript;base64,${Buffer
  .from(sessionSource)
  .toString("base64")}`;
const statusSource = await readFile(
  new URL("./sync-status.js", import.meta.url),
  "utf8"
);
const statusModuleSource = statusSource
  .replace(
    'import { verifySession } from "../auth/session.js";',
    `const { verifySession } = await import("${sessionModuleUrl}");`
  )
  .replace(
    'import { getOzonDateWindow } from "./finance-sync.js";',
    `const { getOzonDateWindow } = await import("${moduleUrl}");`
  );
const { onRequestGet: getSyncStatus } = await import(
  `data:text/javascript;base64,${Buffer
    .from(statusModuleSource)
    .toString("base64")}`
);
const workerSource = await readFile(
  new URL("../../../workers/ozon-finance-sync.js", import.meta.url),
  "utf8"
);
const gateSource = await readFile(
  new URL("../../../workers/ozon-one-shot-gate.js", import.meta.url),
  "utf8"
);
const reconciliationSource = await readFile(
  new URL("./reconciliation-core.js", import.meta.url),
  "utf8"
);
const reconciliationModuleUrl = `data:text/javascript;base64,${Buffer
  .from(reconciliationSource)
  .toString("base64")}`;
const gateModuleUrl = `data:text/javascript;base64,${Buffer
  .from(gateSource)
  .toString("base64")}`;
const workerModuleSource = workerSource.replace(
  'import { WorkerEntrypoint } from "cloudflare:workers";',
  `class WorkerEntrypoint {
    constructor({ env, ctx }) {
      this.env = env;
      this.ctx = ctx;
    }
  }`
).replace(
'import { getOzonDateWindow, syncOzonFinance } from "../functions/api/ozon/finance-sync.js";',
`const { getOzonDateWindow, syncOzonFinance } = await import("${moduleUrl}");`
).replace(
  'import { claimOzonOneShotGate } from "./ozon-one-shot-gate.js";',
  `const { claimOzonOneShotGate } = await import("${gateModuleUrl}");`
).replace(
  /import\s*\{\s*previewOzonDay,\s*reconcileOzonDay\s*\}\s*from\s*"\.\.\/functions\/api\/ozon\/reconciliation-core\.js";/,
  `const { previewOzonDay, reconcileOzonDay } = await import("${reconciliationModuleUrl}");`
);
const { default: OzonFinanceSyncWorker } = await import(
  `data:text/javascript;base64,${Buffer
    .from(workerModuleSource)
    .toString("base64")}`
);

class MockStatement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim().toLowerCase();
    this.values = values;
  }

  bind(...values) {
    if (
      this.db.failLockBind &&
      this.sql.startsWith("insert into ozon_api_sync_lock")
    ) {
      throw new Error("local lock SQL bind failure");
    }
    return new MockStatement(this.db, this.sql, values);
  }

  async first() {
    if (this.sql === "select 1 as probe") {
      if (this.db.hangProbeSelect) {
        return new Promise(() => {});
      }
      if (this.db.failProbeSelect) {
        throw new Error("local read-only probe SELECT failure");
      }
      return { probe: 1 };
    }

    if (this.sql.startsWith("select case when lock_token")) {
      return { active: this.db.locked ? 1 : 0 };
    }

    if (this.sql.startsWith("update ozon_api_one_shot_gate")) {
      const [
        claimedAt,
        claimToken,
        updatedAt,
        date,
        maxPages
      ] = this.values;
      const gate = this.db.gate;
      if (
        gate.status !== "armed" ||
        gate.syncDate !== date ||
        gate.maxPages !== maxPages
      ) {
        return null;
      }

      Object.assign(gate, {
        status: "claimed",
        claimedAt,
        claimToken,
        updatedAt
      });
      return {
        sync_date: gate.syncDate,
        max_pages: gate.maxPages,
        status: gate.status,
        claim_token: gate.claimToken
      };
    }

    if (this.sql.startsWith("insert into ozon_api_sync_lock")) {
      if (this.db.failLockClaim) {
        throw new Error("local D1 lock failure");
      }
      if (this.db.locked) return null;
      this.db.locked = true;
      return { lock_token: this.values[0] };
    }

    if (this.sql.startsWith("select lock_token from ozon_api_sync_lock")) {
      return this.db.locked
        ? { lock_token: this.values[0] }
        : null;
    }

    if (this.sql.includes("from ozon_api_sync_state")) {
      const state = this.db.states.get(this.values[0]);
      return state
        ? {
            status: state.status,
            last_id: state.lastId,
            page_count: state.pageCount || 0,
            record_count: state.recordCount || 0,
            updated_at: state.updatedAt || null,
            page_complete: state.pageComplete ? 1 : 0
          }
        : null;
    }

    throw new Error(`Unexpected first query: ${this.sql}`);
  }

  async all() {
    if (this.sql.includes("from ozon_api_accruals")) {
      const selected = new Set(this.values);
      return {
        results: [...this.db.accruals.values()]
          .filter(row => selected.has(row.id))
          .map(row => ({
            accrual_id: row.id,
            operation_date: row.operationDate,
            accrued_category: row.category,
            unit_number: row.unitNumber,
            total_kopecks: row.totalKopecks,
            currency: "RUB",
            reconciled: row.reconciled
          }))
      };
    }

    if (this.sql.includes("from ozon_api_accrual_components")) {
      const selected = new Set(this.values);
      return {
        results: [...this.db.components.values()]
          .filter(row => selected.has(row.accrualId))
          .map(row => ({
            accrual_id: row.accrualId,
            sku: row.sku,
            type_id: row.typeId,
            amount_kopecks: row.amountKopecks
          }))
      };
    }

    if (this.sql.includes("from ozon_api_sync_state")) {
      const [start, end] = this.values;
      return {
        results: [...this.db.states.entries()]
          .filter(([date]) => date >= start && date <= end)
          .map(([, state]) => ({
            status: state.status,
            page_complete: state.pageComplete ? 1 : 0
          }))
      };
    }

    throw new Error(`Unexpected all query: ${this.sql}`);
  }

  async run() {
    const values = this.values;

    if (this.sql.startsWith("insert into ozon_api_sync_runs")) {
      if (this.db.failRunInsert) {
        throw new Error("local D1 run insert failure");
      }
      this.db.runs.set(values[0], {
        runId: values[0],
        status: "running",
        startedAt: values[4]
      });
      return { success: true };
    }

    if (this.sql.startsWith("update ozon_api_sync_lock")) {
      this.db.locked = false;
      return { success: true };
    }

    if (this.sql.startsWith("insert into ozon_api_sync_state")) {
      const state = this.db.states.get(values[0]) || {};
      Object.assign(state, {
        status: "running",
        lastId: values[2],
        pageCount: values[3],
        recordCount: values[4],
        pageComplete: false,
        lastErrorCode: null,
        updatedAt: values[5]
      });
      this.db.states.set(values[0], state);
      return { success: true };
    }

    if (
      this.sql.startsWith("update ozon_api_sync_state") &&
      this.sql.includes("set last_id =")
    ) {
      const [lastId, pageCount, recordCount, errorCode, date] = values;
      const state = this.db.states.get(date);
      Object.assign(state, {
        lastId,
        pageCount,
        recordCount,
        lastErrorCode: errorCode
      });
      return { success: true };
    }

    if (
      this.sql.startsWith("update ozon_api_sync_state") &&
      this.sql.includes("set status = 'complete'")
    ) {
      const completedAt = values[6];
      const date = values[7];
      const state = this.db.states.get(date);
      Object.assign(state, {
        status: "complete",
        lastId: "",
        pageComplete: true,
        lastErrorCode: null,
        completedAt
      });
      return { success: true };
    }

    if (this.sql.startsWith("update ozon_api_sync_state")) {
      const [status, lastId, errorCode, completedAt, date] = values;
      const state = this.db.states.get(date);
      Object.assign(state, {
        status,
        lastId,
        pageComplete: false,
        lastErrorCode: errorCode,
        completedAt
      });
      return { success: true };
    }

    if (this.sql.startsWith("update ozon_api_sync_runs")) {
      const [
        status,
        pageCount,
        recordCount,
        retryCount,
        typesSynced,
        errorCode,
        finishedAt,
        runId
      ] = values;
      Object.assign(this.db.runs.get(runId), {
        status,
        pageCount,
        recordCount,
        retryCount,
        typesSynced,
        errorCode,
        finishedAt
      });
      return { success: true };
    }

    throw new Error(`Unexpected run query: ${this.sql}`);
  }
}

class MockD1 {
  constructor() {
    this.gate = {
      syncDate: "2026-10-28",
      maxPages: 2,
      status: "disarmed",
      claimedAt: null,
      claimToken: null
    };
    this.locked = false;
    this.runs = new Map();
    this.states = new Map();
    this.accruals = new Map();
    this.components = new Map();
    this.types = new Map();
    this.preparedSql = [];
  }

  prepare(sql) {
    this.preparedSql.push(sql.replace(/\s+/g, " ").trim().toLowerCase());
    if (this.failLockPrepare && /insert into ozon_api_sync_lock/i.test(sql)) {
      throw new Error("local lock SQL prepare failure");
    }
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      const { sql, values } = statement;
      if (
        sql.startsWith("update ozon_api_sync_runs") &&
        sql.includes("where run_id = ? and status = 'running'")
      ) {
        const [finishedAt, runId] = values;
        const run = this.runs.get(runId);
        if (run?.status === "running") {
          Object.assign(run, {
            status: "failed",
            errorCode: "background_sync_unavailable",
            finishedAt
          });
        }
      } else if (
        sql.startsWith("update ozon_api_sync_lock") &&
        sql.includes("where lock_id = 1 and lock_token = ?")
      ) {
        this.locked = false;
      } else if (sql.startsWith("delete from ozon_api_accrual_components")) {
        const [accrualId] = values;
        const accrual = this.accruals.get(accrualId);
        if (accrual?.reconciled === 1) {
          results.push({ success: true, meta: { changes: 0 } });
          continue;
        }
        for (const [componentId, component] of this.components) {
          if (component.accrualId === accrualId) {
            this.components.delete(componentId);
          }
        }
      } else if (sql.startsWith("insert into ozon_api_accruals")) {
        const [
          id,
          operationDate,
          period,
          category,
          unitNumber,
          totalKopecks,
          source
        ] = values;
        this.accruals.set(id, {
          id,
          operationDate,
          period,
          category,
          unitNumber,
          totalKopecks,
          source,
          reconciled: 0
        });
      } else if (
        sql.startsWith("insert into ozon_api_accrual_components")
      ) {
        const [
          id,
          accrualId,
          sku,
          typeId,
          amountKopecks
        ] = values;
        this.components.set(id, {
          id,
          accrualId,
          sku,
          typeId,
          amountKopecks
        });
      } else if (sql.startsWith("insert into ozon_api_accrual_types")) {
        const [id, name, description] = values;
        this.types.set(id, { id, name, description });
      } else if (
        sql.startsWith("insert into ozon_api_accrual_discrepancies")
      ) {
        this.discrepancies = (this.discrepancies || 0) + 1;
      } else {
        throw new Error(`Unexpected batch query: ${sql}`);
      }
      results.push({ success: true, meta: { changes: 1 } });
    }

    return results;
  }
}

function accrual(id, amount, feeAmount = "0.00") {
  return {
    accrual_id: id,
    date: "2026-10-28",
    accrued_category: "POSTING",
    unit_number: `posting-${id}`,
    total_amount: { amount, currency: "RUB" },
    item_fees: {
      fees: [{
        sku: 5001,
        fees: [{
          type_id: 7,
          accrued: { amount: feeAmount, currency: "RUB" }
        }]
      }]
    }
  };
}

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

function environment(db) {
  return {
    OZON_FINANCE_DB: db,
    OZON_CLIENT_ID: "local-client-id",
    OZON_API_KEY: "local-api-key"
  };
}

function armTestGate(db) {
  db.gate.status = "armed";
  db.gate.armedAt = new Date().toISOString();
}

const reconciliationManifest = {
  operationDate: "2026-10-28",
  report: {
    name: "local-test-report.xlsx",
    sha256: "b".repeat(64),
    detailRows: 1
  },
  expectedTotalKopecks: 100,
  expectedPositiveKopecks: 100,
  expectedNegativeKopecks: 0,
  accruals: [{
    accrualId: "101",
    operationDate: "2026-10-28",
    unitNumber: "shipment-1",
    category: "POSTING",
    totalKopecks: 100
  }],
  groups: [{
    unitNumber: "shipment-1",
    detailRows: 1,
    totalKopecks: 100
  }]
};

function reconciliationDb() {
  const rows = [{
    accrual_id: "101",
    operation_date: "2026-10-28",
    unit_number: "shipment-1",
    accrued_category: "POSTING",
    total_kopecks: 100,
    currency: "RUB",
    reconciled: 0
  }];
  const db = {
    rows,
    activeLock: null,
    batchCalls: 0,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      const statement = {
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first() {
          if (normalized.includes("from ozon_api_reconciliation_audit")) {
            return null;
          }
          if (normalized.includes("from ozon_api_sync_state")) {
            return {
              status: "complete",
              page_count: 1,
              record_count: 1,
              page_complete: 1,
              reconciled: 0
            };
          }
          if (normalized.includes("from ozon_api_sync_runs")) {
            return { run_id: "local-complete-run" };
          }
          if (normalized.includes("from ozon_api_sync_lock")) {
            return db.activeLock;
          }
          if (normalized.includes("from ozon_api_accrual_discrepancies")) {
            return null;
          }
          throw new Error(`Unexpected reconciliation query: ${normalized}`);
        },
        async all() {
          if (normalized.includes("from ozon_api_accruals")) {
            return { results: db.rows };
          }
          throw new Error(`Unexpected reconciliation query: ${normalized}`);
        }
      };
      return statement;
    },
    async batch(statements) {
      this.batchCalls++;
      const expected = JSON.parse(statements[0].values[0]);
      return statements.map((statement, index) => ({
        success: true,
        meta: { changes: index === 0 ? 1 : expected.length }
      }));
    }
  };
  return db;
}

function makeManualWorker(db, overrides = {}) {
  let task;
  let waitUntilCalls = 0;
  const worker = new OzonFinanceSyncWorker({
    env: {
      ...environment(db),
      OZON_FINANCE_SYNC_TEST_DATE: "2026-10-28",
      OZON_FINANCE_SYNC_TEST_MAX_PAGES: "2",
      ...overrides
    },
    ctx: {
      waitUntil(promise) {
        waitUntilCalls++;
        task = promise;
      }
    }
  });
  return {
    worker,
    get task() { return task; },
    get waitUntilCalls() { return waitUntilCalls; }
  };
}

async function completesWithin(promise, timeoutMs = 1000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("RPC did not complete in time")),
          timeoutMs
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function ownerCookie() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: "local-owner",
    iat: now,
    exp: now + 8 * 60 * 60
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("local-session-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  )).toString("base64url");

  return `__Host-office_session=${payload}.${signature}`;
}

test("parses exact signed kopecks without floating-point rounding", () => {
  assert.equal(moneyToKopecks("12.34", "RUB"), 1234);
  assert.equal(moneyToKopecks("-0.05", "RUB"), -5);
  assert.equal(moneyToKopecks("8", "RUB"), 800);
  assert.throws(() => moneyToKopecks("1.234", "RUB"));
  assert.throws(() => moneyToKopecks("1.00", "USD"));
});

test("uses the last three completed Moscow dates across month rollover", () => {
  assert.deepEqual(
    getOzonDateWindow(new Date("2026-11-01T12:00:00Z")),
    ["2026-10-29", "2026-10-30", "2026-10-31"]
  );
  assert.deepEqual(
    getOzonDateWindow(new Date("2026-11-01T06:00:00Z")),
    ["2026-10-29", "2026-10-30", "2026-10-31"]
  );
  assert.deepEqual(
    getOzonDateWindow(new Date("2026-11-02T06:00:00Z")),
    ["2026-10-30", "2026-10-31", "2026-11-01"]
  );
  assert.deepEqual(
    getOzonDateWindow(new Date("2026-11-02T06:00:00Z"), 1),
    ["2026-11-01"]
  );
  assert.deepEqual(
    getOzonDateWindow(new Date("2026-11-01T00:30:00Z")),
    ["2026-10-29", "2026-10-30", "2026-10-31"]
  );
});

test("rejects invalid date sets and page limits before recording a run", async () => {
  const db = new MockD1();

  await assert.rejects(
    syncOzonFinance(environment(db), {
      dates: ["2026-10-28T00:00:00Z"]
    }),
    error => error.code === "invalid_sync_dates"
  );
  await assert.rejects(
    syncOzonFinance(environment(db), {
      dates: ["2026-10-28", "2026-10-28"]
    }),
    error => error.code === "invalid_sync_dates"
  );
  await assert.rejects(
    syncOzonFinance(environment(db), {
      dates: ["2026-10-28"],
      maxPagesPerDay: 41
    }),
    error => error.code === "invalid_page_limit"
  );
  assert.equal(db.runs.size, 0);
});

test("paginates by last_id, upserts stable accrual IDs, and updates details", async () => {
  const db = new MockD1();
  let version = 1;
  const requests = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(options.body);
    requests.push({ path, body });

    if (path.endsWith("/accrual/types")) {
      return response({
        accrual_types: [{ id: 7, name: "Commission" }]
      });
    }

    assert.equal(path, "/v1/finance/accrual/by-day");
    if (body.date !== "2026-10-28") {
      return response({ accruals: [], last_id: "" });
    }

    if (!body.last_id) {
      return response({
        accruals: [
          accrual(1, version === 1 ? "1.01" : "1.11",
            version === 1 ? "-0.15" : "-0.20")
        ],
        last_id: "cursor-page-two"
      });
    }

    return response({
      accruals: [accrual(2, "2.02", "-0.25")],
      last_id: ""
    });
  };
  const options = {
    now: new Date("2026-10-28T12:00:00Z"),
    dates: ["2026-10-28"],
    fetchImpl,
    minRequestIntervalMs: 0,
    sleep: async () => {}
  };

  const first = await syncOzonFinance(environment(db), options);
  assert.equal(first.status, "complete");
  assert.equal(first.pageCount, 2);
  assert.equal(first.recordCount, 2);
  assert.equal(db.accruals.size, 2);
  assert.equal(
    [...db.accruals.values()]
      .reduce((sum, record) => sum + record.totalKopecks, 0),
    303
  );
  assert.equal(db.components.size, 2);
  assert.equal(db.types.size, 1);
  assert.ok(requests.some(item =>
    item.body.last_id === "cursor-page-two"
  ));

  version = 2;
  const second = await syncOzonFinance(environment(db), options);

  assert.equal(second.status, "complete");
  assert.equal(db.accruals.size, 2);
  assert.equal(db.accruals.get("1").totalKopecks, 111);
  assert.equal(db.components.size, 2);
  assert.equal(db.components.get("1:5001:7").amountKopecks, -20);
  assert.equal(
    [...db.accruals.values()]
      .reduce((sum, record) => sum + record.totalKopecks, 0),
    313
  );
  assert.equal(db.runs.size, 2);
});

test("accepts documented null item_fees and keeps total_amount in exact kopecks", async () => {
  const db = new MockD1();
  const apiAccrual = {
    accrual_id: 731,
    accrued_category: "CONTAINER_FEES",
    date: "2026-10-28",
    item_fees: null,
    posting: null,
    container_fees: {
      fees: [{
        type_id: 19,
        accrued: { amount: "-1.07", currency: "RUB" }
      }]
    },
    total_amount: { amount: "123.45", currency: "RUB" }
  };
  const result = await syncOzonFinance(environment(db), {
    dates: ["2026-10-28"],
    fetchImpl: async url => new URL(url).pathname.endsWith("/accrual/types")
      ? response({ accrual_types: [] })
      : response({ accruals: [apiAccrual], last_id: "" }),
    minRequestIntervalMs: 0,
    sleep: async () => {}
  });

  assert.equal(result.status, "complete");
  assert.equal(result.pageCount, 1);
  assert.equal(result.recordCount, 1);
  assert.equal(db.accruals.get("731").totalKopecks, 12345);
  assert.equal(db.components.size, 0);
});

test("accepts an omitted optional item-fee list but rejects unexpected nesting", async () => {
  const optionalDb = new MockD1();
  const optionalResult = await syncOzonFinance(environment(optionalDb), {
    dates: ["2026-10-28"],
    fetchImpl: async url => new URL(url).pathname.endsWith("/accrual/types")
      ? response({ accrual_types: [] })
      : response({
          accruals: [{
            accrual_id: 732,
            date: "2026-10-28",
            total_amount: { amount: "0.09", currency: "RUB" },
            item_fees: { fees: [{}] }
          }],
          last_id: ""
        }),
    minRequestIntervalMs: 0,
    sleep: async () => {}
  });

  assert.equal(optionalResult.status, "complete");
  assert.equal(optionalDb.accruals.get("732").totalKopecks, 9);

  const malformedDb = new MockD1();
  const malformedResult = await syncOzonFinance(environment(malformedDb), {
    dates: ["2026-10-28"],
    fetchImpl: async url => new URL(url).pathname.endsWith("/accrual/types")
      ? response({ accrual_types: [] })
      : response({
          accruals: [{
            accrual_id: 733,
            date: "2026-10-28",
            total_amount: { amount: "1.00", currency: "RUB" },
            item_fees: {
              fees: [{
                sku: 5001,
                fees: { type_id: 7 }
              }]
            }
          }],
          last_id: ""
        }),
    minRequestIntervalMs: 0,
    sleep: async () => {}
  });

  assert.equal(malformedResult.status, "failed");
  assert.equal(
    malformedResult.errorCode,
    "invalid_details_item_fees_group_fees_object_count_1"
  );
  assert.doesNotMatch(malformedResult.errorCode, /5001|type_id|1\.00/);
  assert.equal(malformedDb.accruals.size, 0);
});

test("honors Retry-After on HTTP 429 before retrying", async () => {
  const db = new MockD1();
  const delays = [];
  let typeCalls = 0;
  const result = await syncOzonFinance(environment(db), {
    now: new Date("2026-10-28T12:00:00Z"),
    minRequestIntervalMs: 0,
    sleep: async milliseconds => delays.push(milliseconds),
    fetchImpl: async url => {
      if (new URL(url).pathname.endsWith("/accrual/types")) {
        typeCalls++;
        if (typeCalls === 1) {
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "2" }
          });
        }

        return response({ accrual_types: [] });
      }

      return response({ accruals: [], last_id: "" });
    }
  });

  assert.equal(result.status, "complete");
  assert.equal(result.retryCount, 1);
  assert.ok(delays.includes(2000));
});

test("restarts an incomplete date with an empty expired Ozon cursor", async () => {
  const db = new MockD1();
  const requestCursors = [];
  const options = {
    now: new Date("2026-10-28T12:00:00Z"),
    minRequestIntervalMs: 0,
    maxPagesPerDay: 1,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname.endsWith("/accrual/types")) {
        return response({ accrual_types: [] });
      }

      requestCursors.push(JSON.parse(init.body).last_id);
      return response({ accruals: [], last_id: "short-lived-cursor" });
    }
  };

  const first = await syncOzonFinance(environment(db), options);
  const second = await syncOzonFinance(environment(db), {
    ...options,
    now: new Date("2026-10-28T12:15:00Z")
  });

  assert.equal(first.status, "partial");
  assert.equal(second.status, "partial");
  assert.deepEqual(requestCursors, ["", "", "", "", "", ""]);
});

test("retries a timed-out Ozon request and completes the page", async () => {
  const db = new MockD1();
  const delays = [];
  let pageCalls = 0;
  const result = await syncOzonFinance(environment(db), {
    now: new Date("2026-10-28T12:00:00Z"),
    minRequestIntervalMs: 0,
    sleep: async milliseconds => delays.push(milliseconds),
    fetchImpl: async url => {
      if (new URL(url).pathname.endsWith("/accrual/types")) {
        return response({ accrual_types: [] });
      }

      pageCalls++;
      if (pageCalls === 1) {
        const error = new Error("local timeout");
        error.name = "TimeoutError";
        throw error;
      }

      return response({ accruals: [], last_id: "" });
    }
  });

  assert.equal(result.status, "complete");
  assert.equal(result.retryCount, 1);
  assert.ok(delays.includes(1000));
});

test("manual RPC limits the run to 2026-10-28 and two pages", async () => {
  const db = new MockD1();
  armTestGate(db);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(options.body);
    calls.push({ path, body });

    if (path.endsWith("/accrual/types")) {
      return response({ accrual_types: [] });
    }

    assert.equal(body.date, "2026-10-28");
    if (!body.last_id) {
      return response({
        accruals: [accrual(11, "3.25")],
        last_id: "second-page"
      });
    }

    assert.equal(body.last_id, "second-page");
    return response({
      accruals: [accrual(12, "4.50")],
      last_id: ""
    });
  };

  try {
    const invocation = makeManualWorker(db);
    const started = await invocation.worker.startOneShotSync();
    const pageCalls = calls.filter(item =>
      item.path.endsWith("/accrual/by-day")
    );

    const result = started;
    assert.equal(result.status, "complete");
    assert.equal(started.date, "2026-10-28");
    assert.equal(started.maxPages, 2);
    assert.equal(result.date, "2026-10-28");
    assert.equal(result.maxPages, 2);
    assert.equal(result.pageCount, 2);
    assert.equal(pageCalls.length, 2);
    assert.ok(pageCalls.every(item => item.body.date === "2026-10-28"));
    assert.equal(db.states.size, 1);
    assert.deepEqual([...db.accruals.keys()].sort(), ["11", "12"]);
    assert.equal(db.gate.status, "claimed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual RPC reports partial when the page limit leaves a cursor", async () => {
  const db = new MockD1();
  armTestGate(db);
  const originalFetch = globalThis.fetch;
  let pageCalls = 0;
  globalThis.fetch = async url => {
    if (new URL(url).pathname.endsWith("/accrual/types")) {
      return response({ accrual_types: [] });
    }

    pageCalls++;
    return response({
      accruals: [accrual(pageCalls, "1.00")],
      last_id: `cursor-${pageCalls}`
    });
  };

  try {
    const invocation = makeManualWorker(db);
    const result = await invocation.worker.startOneShotSync();
    const state = db.states.get("2026-10-28");

    assert.equal(result.status, "partial");
    assert.equal(result.errorCode, "page_limit_reached");
    assert.equal(result.pageCount, 2);
    assert.equal(pageCalls, 2);
    assert.equal(state.status, "partial");
    assert.equal(state.pageComplete, false);
    assert.equal(db.gate.status, "claimed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual RPC refuses missing or widened safety limits before claiming", async () => {
  const db = new MockD1();
  armTestGate(db);
  const wrongDate = makeManualWorker(db, {
    OZON_FINANCE_SYNC_TEST_DATE: "2026-10-29"
  });
  const wrongPages = makeManualWorker(db, {
    OZON_FINANCE_SYNC_TEST_MAX_PAGES: "3"
  });

  assert.equal(
    (await wrongDate.worker.startOneShotSync()).errorCode,
    "controlled_test_configuration_required"
  );
  assert.equal(
    (await wrongPages.worker.startOneShotSync()).errorCode,
    "controlled_test_configuration_required"
  );
  assert.equal(db.gate.status, "armed");
  assert.equal(db.runs.size, 0);
});

test("does not call Ozon while the one-shot gate is disarmed", async () => {
  const db = new MockD1();
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("Ozon must not be called");
  };

  try {
    const invocation = makeManualWorker(db);
    const result = await invocation.worker.startOneShotSync();

    assert.equal(result.status, "rejected");
    assert.equal(result.errorCode, "one_shot_gate_not_armed_or_already_claimed");
    assert.equal(fetchCalls, 0);
    assert.equal(db.runs.size, 0);
    assert.equal(db.gate.status, "disarmed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("atomically allows only one of concurrent manual RPC invocations", async () => {
  const db = new MockD1();
  armTestGate(db);
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    fetchCalls++;
    if (new URL(url).pathname.endsWith("/accrual/types")) {
      return response({ accrual_types: [] });
    }

    return response({ accruals: [], last_id: "" });
  };

  try {
    const first = makeManualWorker(db);
    const second = makeManualWorker(db);
    const results = await Promise.all([
      first.worker.startOneShotSync(),
      second.worker.startOneShotSync()
    ]);

    assert.equal(results.filter(result => result.status === "complete").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(fetchCalls, 2);
    assert.equal(db.runs.size, 1);
    assert.equal(db.gate.status, "claimed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps the gate claimed after an Ozon API failure", async () => {
  const db = new MockD1();
  armTestGate(db);
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    fetchCalls++;
    return new URL(url).pathname.endsWith("/accrual/types")
      ? response({ accrual_types: [] })
      : response({ message: "private upstream detail" }, 403);
  };

  try {
    const first = makeManualWorker(db);
    const firstResult = await first.worker.startOneShotSync();
    const second = makeManualWorker(db);
    const secondResponse = await second.worker.startOneShotSync();

    assert.equal(firstResult.status, "failed");
    assert.equal(firstResult.errorCode, "ozon_http_403");
    assert.equal(secondResponse.status, "rejected");
    assert.equal(fetchCalls, 2);
    assert.equal(db.runs.size, 1);
    assert.equal(db.gate.status, "claimed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual RPC exposes only safe one-shot result totals", async () => {
  const db = {
    prepare(sql) {
      const statement = {
        bind(...values) {
          if (sql.includes("FROM ozon_api_sync_runs")) {
            assert.deepEqual(values, [
              "2026-10-28",
              "2026-10-28",
              "ozon_seller_api"
            ]);
          } else if (sql.includes("FROM ozon_api_sync_state")) {
            assert.deepEqual(values, ["2026-10-28", "ozon_seller_api"]);
          } else if (sql.includes("FROM ozon_api_accruals")) {
            assert.deepEqual(values, ["2026-10-28", "ozon_seller_api"]);
          }
          return statement;
        },
        async first() {
          if (sql.includes("FROM ozon_api_one_shot_gate")) {
            return {
              sync_date: "2026-10-28",
              max_pages: 2,
              status: "claimed",
              claimed_at: "2026-10-28T00:00:00Z",
              claim_token: "must-not-leak"
            };
          }
          if (sql.includes("FROM ozon_api_sync_runs")) {
            return {
              status: "partial",
              page_count: 2,
              record_count: 3,
              retry_count: 1,
              types_synced: 0,
              error_code: "page_limit_reached",
              started_at: "2026-10-28T00:00:00Z",
              finished_at: "2026-10-28T00:01:00Z",
              run_id: "must-not-leak"
            };
          }
          if (sql.includes("FROM ozon_api_sync_state")) {
            return {
              status: "partial",
              page_count: 2,
              record_count: 3,
              page_complete: 0,
              reconciled: 0,
              last_error_code: "page_limit_reached",
              last_started_at: "2026-10-28T00:00:00Z",
              last_completed_at: "2026-10-28T00:01:00Z"
            };
          }
          if (sql.includes("FROM ozon_api_accruals")) {
            return {
              record_count: 3,
              unique_count: 3,
              total_kopecks: 12345
            };
          }
          throw new Error(`Unexpected result query: ${sql}`);
        }
      };
      return statement;
    }
  };
  const worker = new OzonFinanceSyncWorker({
    env: {
      OZON_FINANCE_DB: db,
      OZON_FINANCE_SYNC_TEST_DATE: "2026-10-28",
      OZON_FINANCE_SYNC_TEST_MAX_PAGES: "2"
    },
    ctx: { waitUntil: () => {} }
  });

  const result = await worker.getOneShotSyncResult();

  assert.equal(result.status, "partial");
  assert.equal(result.gateStatus, "claimed");
  assert.equal(result.accruals.totalKopecks, 12345);
  assert.equal(result.accruals.duplicateCount, 0);
  assert.equal(result.run.errorCode, "page_limit_reached");
  assert.equal("claimToken" in result, false);
  assert.equal("runId" in result.run, false);
});

test("Worker has no HTTP launch route", async () => {
  const worker = makeManualWorker(new MockD1());
  const response = await worker.worker.fetch();
  assert.equal(response.status, 404);
});

test("dashboard keeps components separate and flags unresolved drift", async () => {
  const operationRows = [
    {
      accrual_id: "101",
      operation_date: "2026-10-28",
      period: "2026-10",
      accrued_category: "POSTING",
      unit_number: "posting-1",
      total_kopecks: 500,
      reconciled: 1,
      updated_at: "2026-10-28T12:00:00.000Z"
    },
    {
      accrual_id: "102",
      operation_date: "2026-10-28",
      period: "2026-10",
      accrued_category: "ITEM",
      unit_number: "posting-1",
      total_kopecks: -200,
      reconciled: 1,
      updated_at: "2026-10-28T12:00:00.000Z"
    }
  ];
  const fakeDb = {
    prepare(sql) {
      let values = [];
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      const statement = {
        bind(...bound) {
          values = bound;
          return statement;
        },
        async all() {
          if (normalized.includes("from ozon_api_sync_state as state")) {
            return { results: [{
              sync_date: "2026-10-28",
              status: "complete",
              page_count: 1,
              record_count: 2,
              page_complete: 1,
              reconciled: 1,
              last_error_code: null,
              last_started_at: "2026-10-28T12:00:00.000Z",
              last_completed_at: "2026-10-28T12:01:00.000Z",
              actual_record_count: 2,
              total_kopecks: 300,
              positive_kopecks: 500,
              negative_kopecks: -200,
              positive_count: 1,
              negative_count: 1
            }] };
          }
          if (normalized.startsWith("select accrued_category")) {
            return { results: [
              {
                accrued_category: "POSTING",
                record_count: 1,
                total_kopecks: 500,
                positive_kopecks: 500,
                negative_kopecks: 0,
                positive_count: 1,
                negative_count: 0
              },
              {
                accrued_category: "ITEM",
                record_count: 1,
                total_kopecks: -200,
                positive_kopecks: 0,
                negative_kopecks: -200,
                positive_count: 0,
                negative_count: 1
              }
            ] };
          }
          if (normalized.startsWith("select accrual_id")) {
            return { results: operationRows };
          }
          if (normalized.includes("from ozon_api_accrual_types")) {
            return { results: [{
              type_id: 7,
              name: "Commission",
              description: "Seller API detail"
            }] };
          }
          if (normalized.includes("from ozon_api_reconciliation_audit")) {
            return { results: [] };
          }
          if (normalized.includes("from ozon_api_accrual_discrepancies")) {
            return { results: [{
              operation_date: "2026-10-28",
              discrepancy_count: 1
            }] };
          }
          if (normalized.includes("from ozon_api_accrual_components")) {
            return { results: [{
              accrual_id: "101",
              sku: "5001",
              type_id: 7,
              amount_kopecks: -10
            }] };
          }
          throw new Error(`Unexpected dashboard query: ${normalized}`);
        },
        async first() {
          assert.equal(values[0], "ozon_seller_api");
          if (normalized.includes("status = 'complete'")) {
            return { finished_at: "2026-10-28T12:01:00.000Z" };
          }
          assert.match(normalized, /status != 'skipped'/);
          return {
            run_id: "run-1",
            status: "complete",
            period_start: "2026-10-28",
            period_end: "2026-10-28",
            page_count: 1,
            record_count: 2,
            retry_count: 0,
            types_synced: 1,
            error_code: null,
            started_at: "2026-10-28T12:00:00.000Z",
            finished_at: "2026-10-28T12:01:00.000Z"
          };
        }
      };
      return statement;
    }
  };
  const { worker } = makeManualWorker(fakeDb);
  const result = await worker.getFinanceDashboard(
    "2026-10-28",
    "2026-10-28"
  );

  assert.equal(result.totals.recordCount, 2);
  assert.equal(result.totals.totalKopecks, 300);
  assert.equal(result.totals.positiveKopecks, 500);
  assert.equal(result.totals.negativeKopecks, -200);
  assert.deepEqual(result.operations.map(operation => operation.accrualId), [
    "101",
    "102"
  ]);
  assert.deepEqual(result.operations[0].components, [{
    sku: "5001",
    typeId: 7,
    typeName: "Commission",
    amountKopecks: -10
  }]);
  assert.equal(result.totals.totalKopecks, 300);
  assert.equal(result.daily[0].reconciled, false);
  assert.equal(result.daily[0].netStatus, "unverified");
  assert.equal(result.daily[0].detailStatus, "unverified");
  assert.equal(
    result.daily[0].detailReason,
    "official_report_not_registered"
  );
  assert.deepEqual(result.componentVerification, {
    status: "unverified",
    reason: "ozon_api_component_mapping_incomplete"
  });
  assert.equal(result.lastSuccessfulAt, "2026-10-28T12:01:00.000Z");
  assert.equal(result.operations[0].reconciled, false);
});

test("dashboard returns unknown amounts when the selected period has no coverage", async () => {
  const fakeDb = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
      const statement = {
        bind() {
          return statement;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        }
      };
      assert.match(normalized, /from ozon_api_/);
      return statement;
    }
  };
  const { worker } = makeManualWorker(fakeDb);
  const result = await worker.getFinanceDashboard(
    "2026-10-27",
    "2026-10-27"
  );

  assert.equal(result.totals.recordCount, null);
  assert.equal(result.totals.totalKopecks, null);
  assert.equal(result.daily[0].recordCount, null);
  assert.equal(result.daily[0].totalKopecks, null);
  assert.equal(result.lastSuccessfulAt, null);
});

test("dashboard rejects invalid and oversized date ranges", async () => {
  const { worker } = makeManualWorker(new MockD1());
  await assert.rejects(
    worker.getFinanceDashboard("2026-02-30", "2026-03-01"),
    /invalid_dashboard_period/
  );
  await assert.rejects(
    worker.getFinanceDashboard("2026-10-01", "2026-11-01"),
    /dashboard_period_too_large/
  );
});

test("scheduled handler ignores unconfigured Cron expressions", async () => {
  const db = new MockD1();
  const { worker } = makeManualWorker(db);
  assert.deepEqual(
    await worker.scheduled({ cron: "*/5 * * * *" }),
    { status: "ignored", errorCode: "unexpected_schedule" }
  );
  assert.equal(db.runs.size, 0);
});

test("staging Worker uses the approved daily Cron", async () => {
  const config = JSON.parse(await readFile(
    new URL("../../../wrangler.ozon-finance-sync-test.jsonc", import.meta.url),
    "utf8"
  ));
  assert.deepEqual(config.triggers.crons, ["15 3 * * *"]);
  assert.match(workerSource, /const DAILY_CRON = "15 3 \* \* \*"/);
});

test("daily schedule loads the last three completed Moscow dates without using the gate", async () => {
  const db = new MockD1();
  db.gate.status = "claimed";
  const dates = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/accrual/types")) {
      return response({ accrual_types: [] });
    }
    dates.push(JSON.parse(options.body).date);
    return response({ accruals: [], last_id: "" });
  };

  try {
    const { worker } = makeManualWorker(db);
    const result = await worker.scheduled({
      cron: "15 3 * * *",
      scheduledTime: Date.parse("2026-11-01T06:00:00Z")
    });

    assert.equal(result.status, "complete");
    assert.deepEqual([...new Set(dates)], [
      "2026-10-29",
      "2026-10-30",
      "2026-10-31"
    ]);
    assert.equal(db.states.size, 3);
    assert.equal(db.gate.status, "claimed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual recent sync reserves the global lock before accepting and rejects duplicates", async () => {
  const db = new MockD1();
  const originalFetch = globalThis.fetch;
  const requestedDates = [];
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname.endsWith("/accrual/types")) {
      return response({ accrual_types: [] });
    }
    requestedDates.push(JSON.parse(options.body).date);
    return response({ accruals: [], last_id: "" });
  };

  try {
    const invocation = makeManualWorker(db);
    const first = await invocation.worker.startRecentSync();
    const second = await invocation.worker.startRecentSync();

    assert.equal(first.status, "started");
    assert.equal(second.status, "rejected");
    assert.equal(second.errorCode, "sync_already_running");
    assert.equal(db.runs.size, 1);
    assert.equal(db.gate.status, "disarmed");
    assert.equal(invocation.waitUntilCalls, 1);

    await invocation.task;
    assert.equal(db.locked, false);
    assert.equal(db.runs.get(first.runId).status, "complete");
    assert.equal(new Set(requestedDates).size, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual recent sync completes its RPC when D1 lock acquisition fails", async () => {
  const db = new MockD1();
  db.failLockClaim = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.startRecentSync()
  );

  assert.deepEqual(result, {
    status: "unavailable",
    errorCode: "sync_lock_unavailable"
  });
  assert.equal(db.locked, false);
  assert.equal(db.runs.size, 0);
  assert.equal(invocation.waitUntilCalls, 0);
});

test("manual recent sync releases the D1 lock when run creation fails", async () => {
  const db = new MockD1();
  db.failRunInsert = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.startRecentSync()
  );

  assert.deepEqual(result, {
    status: "unavailable",
    errorCode: "sync_run_unavailable"
  });
  assert.equal(db.locked, false);
  assert.equal(db.runs.size, 0);
  assert.equal(invocation.waitUntilCalls, 0);
});

test("manual recent sync rejects a busy lock without registering background work", async () => {
  const db = new MockD1();
  db.locked = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.startRecentSync()
  );

  assert.deepEqual(result, {
    status: "rejected",
    errorCode: "sync_already_running"
  });
  assert.equal(db.runs.size, 0);
  assert.equal(invocation.waitUntilCalls, 0);
});

test("manual recent sync cleans up when waitUntil registration throws", async () => {
  const db = new MockD1();
  let registeredTask;
  let ozonCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    ozonCalls++;
    throw new Error("Ozon must not be called");
  };
  const worker = new OzonFinanceSyncWorker({
    env: {
      ...environment(db),
      OZON_FINANCE_SYNC_TEST_DATE: "2026-10-28",
      OZON_FINANCE_SYNC_TEST_MAX_PAGES: "2"
    },
    ctx: {
      waitUntil(promise) {
        registeredTask = promise;
        throw new Error("local waitUntil failure");
      }
    }
  });

  try {
    const result = await completesWithin(worker.startRecentSync());
    await registeredTask;

    assert.deepEqual(result, {
      status: "unavailable",
      errorCode: "background_sync_unavailable"
    });
    assert.equal(db.locked, false);
    assert.equal(db.runs.size, 1);
    assert.equal([...db.runs.values()][0].status, "failed");
    assert.equal(ozonCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual sync readiness checks Worker background support and active lock", async () => {
  const db = new MockD1();
  const invocation = makeManualWorker(db);

  assert.deepEqual(await invocation.worker.getManualSyncReadiness(), {
    ready: true,
    activeRun: false,
    errorCode: null,
    readOnlyProbe: {
      status: "ready",
      lastSuccessfulStage: "D_bind",
      failedStage: null,
      errorCode: null
    }
  });

  db.locked = true;
  assert.deepEqual(await invocation.worker.getManualSyncReadiness(), {
    ready: false,
    activeRun: true,
    errorCode: null,
    readOnlyProbe: {
      status: "ready",
      lastSuccessfulStage: "D_bind",
      failedStage: null,
      errorCode: null
    }
  });

  const noBackground = new OzonFinanceSyncWorker({
    env: environment(db),
    ctx: {}
  });
  assert.deepEqual(await noBackground.getManualSyncReadiness(), {
    ready: false,
    activeRun: false,
    errorCode: "background_sync_unavailable",
    readOnlyProbe: {
      status: "unavailable",
      lastSuccessfulStage: "A",
      failedStage: "B",
      errorCode: "sync_probe_context_unavailable"
    }
  });

  const missingCredentials = new OzonFinanceSyncWorker({
    env: { ...environment(db), OZON_API_KEY: "" },
    ctx: { waitUntil() {} }
  });
  assert.deepEqual(await missingCredentials.getManualSyncReadiness(), {
    ready: false,
    activeRun: false,
    errorCode: "ozon_credentials_missing",
    readOnlyProbe: {
      status: "ready",
      lastSuccessfulStage: "D_bind",
      failedStage: null,
      errorCode: null
    }
  });
});

test("read-only recent sync probe checks A-D without executing the lock statement", async () => {
  const db = new MockD1();
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.getRecentSyncReadOnlyProbe()
  );

  assert.deepEqual(result, {
    status: "ready",
    lastSuccessfulStage: "D_bind",
    failedStage: null,
    errorCode: null
  });
  assert.ok(db.preparedSql.includes("select 1 as probe"));
  assert.ok(db.preparedSql.some(sql =>
    sql.startsWith("insert into ozon_api_sync_lock")
  ));
  assert.equal(db.locked, false);
  assert.equal(db.runs.size, 0);
  assert.equal(invocation.waitUntilCalls, 0);
});

test("read-only recent sync probe reports SELECT failure without preparing lock SQL", async () => {
  const db = new MockD1();
  db.failProbeSelect = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.getRecentSyncReadOnlyProbe()
  );

  assert.deepEqual(result, {
    status: "unavailable",
    lastSuccessfulStage: "B",
    failedStage: "C",
    errorCode: "sync_probe_select_failed"
  });
  assert.equal(
    db.preparedSql.some(sql => sql.startsWith("insert into ozon_api_sync_lock")),
    false
  );
  assert.equal(db.locked, false);
});

test("read-only recent sync probe times out a pending SELECT without writes", async () => {
  const db = new MockD1();
  db.hangProbeSelect = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.getRecentSyncReadOnlyProbe(),
    3000
  );

  assert.deepEqual(result, {
    status: "unavailable",
    lastSuccessfulStage: "B",
    failedStage: "C",
    errorCode: "sync_probe_timeout"
  });
  assert.equal(
    db.preparedSql.some(sql => sql.startsWith("insert into ozon_api_sync_lock")),
    false
  );
  assert.equal(db.locked, false);
});

test("read-only recent sync probe reports lock SQL prepare failure without execution", async () => {
  const db = new MockD1();
  db.failLockPrepare = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.getRecentSyncReadOnlyProbe()
  );

  assert.deepEqual(result, {
    status: "unavailable",
    lastSuccessfulStage: "C",
    failedStage: "D_prepare",
    errorCode: "sync_probe_prepare_failed"
  });
  assert.equal(db.locked, false);
  assert.equal(db.runs.size, 0);
});

test("read-only recent sync probe reports lock SQL bind failure without execution", async () => {
  const db = new MockD1();
  db.failLockBind = true;
  const invocation = makeManualWorker(db);

  const result = await completesWithin(
    invocation.worker.getRecentSyncReadOnlyProbe()
  );

  assert.deepEqual(result, {
    status: "unavailable",
    lastSuccessfulStage: "D_prepare",
    failedStage: "D_bind",
    errorCode: "sync_probe_bind_failed"
  });
  assert.equal(db.locked, false);
  assert.equal(db.runs.size, 0);
});

test("Worker reconciliation preview is read-only and signs the manifest", async () => {
  const db = reconciliationDb();
  const invocation = makeManualWorker(db, {
    OZON_API_KEY: "local-api-key-long-enough-for-reconciliation-tests"
  });
  const result = await invocation.worker.previewReconciliation(
    reconciliationManifest
  );

  assert.equal(result.status, "ready_to_confirm");
  assert.equal(result.detailStatus, "unverified");
  assert.match(
    result.previewToken,
    /^\d{13}\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/
  );
  assert.equal(db.batchCalls, 0);
});

test("Worker confirm requires a valid preview for the unchanged manifest", async () => {
  const db = reconciliationDb();
  const invocation = makeManualWorker(db, {
    OZON_API_KEY: "local-api-key-long-enough-for-reconciliation-tests"
  });
  const preview = await invocation.worker.previewReconciliation(
    reconciliationManifest
  );
  const changedManifest = structuredClone(reconciliationManifest);
  changedManifest.expectedTotalKopecks++;
  changedManifest.expectedPositiveKopecks++;

  await assert.rejects(
    invocation.worker.confirmReconciliation(
      changedManifest,
      preview.previewToken
    ),
    { message: "reconciliation_preview_manifest_changed" }
  );
  assert.equal(db.batchCalls, 0);

  const result = await invocation.worker.confirmReconciliation(
    reconciliationManifest,
    preview.previewToken
  );
  assert.equal(result.status, "net_verified_details_unverified");
  assert.equal(result.detailStatus, "unverified");
  assert.equal(db.batchCalls, 1);
});

test("Worker confirm rejects missing, expired, or invalid preview tokens", async () => {
  const db = reconciliationDb();
  const invocation = makeManualWorker(db, {
    OZON_API_KEY: "local-api-key-long-enough-for-reconciliation-tests"
  });

  await assert.rejects(
    invocation.worker.confirmReconciliation(reconciliationManifest, ""),
    { message: "reconciliation_preview_required" }
  );
  await assert.rejects(
    invocation.worker.confirmReconciliation(
      reconciliationManifest,
      `0000000000000.${"a".repeat(64)}.${"A".repeat(43)}`
    ),
    { message: "reconciliation_preview_expired" }
  );
  assert.equal(db.batchCalls, 0);
});

test("Worker confirm rechecks accruals and active lock before writing", async () => {
  const db = reconciliationDb();
  const invocation = makeManualWorker(db, {
    OZON_API_KEY: "local-api-key-long-enough-for-reconciliation-tests"
  });
  const preview = await invocation.worker.previewReconciliation(
    reconciliationManifest
  );

  db.rows[0].total_kopecks++;
  await assert.rejects(
    invocation.worker.confirmReconciliation(
      reconciliationManifest,
      preview.previewToken
    ),
    { message: "reconciliation_accrual_mismatch" }
  );
  assert.equal(db.batchCalls, 0);

  db.rows[0].total_kopecks--;
  db.activeLock = { active: 1 };
  await assert.rejects(
    invocation.worker.confirmReconciliation(
      reconciliationManifest,
      preview.previewToken
    ),
    { message: "reconciliation_sync_in_progress" }
  );
  assert.equal(db.batchCalls, 0);
});

test("records network failures after bounded retries", async () => {
  const db = new MockD1();
  const delays = [];
  let typeCalls = 0;
  const result = await syncOzonFinance(environment(db), {
    now: new Date("2026-10-28T12:00:00Z"),
    minRequestIntervalMs: 0,
    sleep: async milliseconds => delays.push(milliseconds),
    fetchImpl: async url => {
      if (new URL(url).pathname.endsWith("/accrual/types")) {
        typeCalls++;
        throw new TypeError("local network failure");
      }

      throw new Error("accrual request must stop after type network error");
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "ozon_network_error");
  assert.equal(result.retryCount, 3);
  assert.equal(typeCalls, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test("marks malformed pages incomplete and records only a safe code", async () => {
  const db = new MockD1();
  const result = await syncOzonFinance(environment(db), {
    now: new Date("2026-10-28T12:00:00Z"),
    minRequestIntervalMs: 0,
    sleep: async () => {},
    fetchImpl: async url => new URL(url).pathname.endsWith("/accrual/types")
      ? response({ accrual_types: [] })
      : response({ accruals: "not-an-array", secret: "not persisted" })
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "invalid_accrual_response");
  assert.ok(
    [...db.states.values()].every(state =>
      state.status === "failed" &&
      state.lastErrorCode === "invalid_accrual_response"
    )
  );
  assert.equal(db.accruals.size, 0);
  assert.equal(
    JSON.stringify([...db.runs.values()])
      .includes("not persisted"),
    false
  );
});

test("records HTTP API errors without persisting the response body", async () => {
  const db = new MockD1();
  const result = await syncOzonFinance(environment(db), {
    now: new Date("2026-10-28T12:00:00Z"),
    minRequestIntervalMs: 0,
    sleep: async () => {},
    fetchImpl: async url => new URL(url).pathname.endsWith("/accrual/types")
      ? response({ accrual_types: [] })
      : response(
          { message: "private upstream detail" },
          403
        )
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "ozon_http_403");
  assert.equal(db.accruals.size, 0);
  assert.equal(
    JSON.stringify([...db.runs.values()])
      .includes("private upstream detail"),
    false
  );
});

test("protects sync status with the Google owner session", async () => {
  let queries = 0;
  let dashboardCalls = 0;
  let owner = true;
  const env = {
    OFFICE_SESSION_SECRET: "local-session-secret",
    OFFICE_ALLOWED_EMAIL: "owner@example.test",
    OZON_FINANCE_DB: {
      prepare(sql) {
        queries++;
        assert.match(sql, /office_authorized_users/);
        assert.doesNotMatch(sql, /ozon_api_accruals/);
        return {
          bind: (...values) => ({
            first: async () => {
              assert.deepEqual(values, [
                "local-owner",
                "owner@example.test"
              ]);
              return owner ? { allowed: 1 } : null;
            }
          })
        };
      }
    },
    OZON_FINANCE_SYNC: {
      async getManualSyncReadiness() {
        return { ready: true, activeRun: false, errorCode: null };
      },
      async getFinanceDashboard() {
        dashboardCalls++;
        return {
          source: "ozon_seller_api",
          currency: "RUB",
          periodStart: "2026-10-28",
          periodEnd: "2026-10-30",
          daily: [{
            date: "2026-10-30",
            status: "partial",
            pageCount: 2,
            recordCount: 2,
            totalKopecks: 12345,
            complete: false,
            reconciled: false,
            errorCode: "ozon_rate_limited"
          }],
          categories: [],
          operations: [],
          totals: {
            recordCount: 2,
            totalKopecks: 12345,
            positiveKopecks: 12345,
            negativeKopecks: 0
          },
          coverage: { days: 3, completeDays: 0, reconciledDays: 0 },
          latestRun: {
            runId: "local-run",
            status: "partial",
            pageCount: 2,
            recordCount: 4,
            retryCount: 1,
            typesSynced: false,
            errorCode: "ozon_rate_limited",
            startedAt: "2026-10-30T00:00:00Z",
            finishedAt: "2026-10-30T00:01:00Z"
          }
        };
      }
    }
  };
  const unauthorized = await getSyncStatus({
    request: new Request("https://office.example/api/ozon/sync-status"),
    env
  });

  assert.equal(unauthorized.status, 401);
  assert.equal(queries, 0);

  owner = false;
  const forbidden = await getSyncStatus({
    request: new Request("https://office.example/api/ozon/sync-status", {
      headers: { Cookie: await ownerCookie() }
    }),
    env
  });
  assert.equal(forbidden.status, 403);

  owner = true;
  const response = await getSyncStatus({
    request: new Request("https://office.example/api/ozon/sync-status", {
      headers: { Cookie: await ownerCookie() }
    }),
    env
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source, "ozon_seller_api");
  assert.equal(body.reconciled, false);
  assert.deepEqual(body.manualSync, {
    ready: true,
    activeRun: false,
    errorCode: null
  });
  assert.equal(body.latestRun.errorCode, "ozon_rate_limited");
  assert.equal(body.daily[0].totalKopecks, 12345);
  assert.equal(body.daily[0].complete, false);
  assert.equal(body.daily[0].reconciled, false);
  assert.equal(queries, 2);
  assert.equal(dashboardCalls, 1);
});
