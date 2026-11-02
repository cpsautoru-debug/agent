


import { getOzonDateWindow, syncOzonFinance } from "../functions/api/ozon/finance-sync.js";
import { WorkerEntrypoint } from "cloudflare:workers";
import { claimOzonOneShotGate } from "./ozon-one-shot-gate.js";

const TEST_DATE = "2026-10-28";
const TEST_MAX_PAGES = 2;
const SOURCE = "ozon_seller_api";
const DAILY_CRON = "0 6 * * *";
const MAX_DASHBOARD_DAYS = 31;
const MAX_DASHBOARD_OPERATIONS = 500;
const SYNC_PROBE_TIMEOUT_MS = 2000;
const OCTOBER_BACKFILL_START = "2026-10-01";
const OCTOBER_BACKFILL_END = "2026-10-31";
const MAX_BACKFILL_PAGES_PER_DAY = 12;
const RECENT_SYNC_LOCK_SQL = `
  INSERT INTO ozon_api_sync_lock (
    lock_id,
    lock_token,
    locked_until
  )
  VALUES (1, ?, datetime('now', '+20 minutes'))
  ON CONFLICT(lock_id) DO UPDATE SET
    lock_token = excluded.lock_token,
    locked_until = excluded.locked_until
  WHERE datetime(ozon_api_sync_lock.locked_until)
    <= CURRENT_TIMESTAMP
  RETURNING lock_token
`;

function safeErrorCode(error) {
  const code = typeof error === "string" ? error : error?.code;
  return typeof code === "string" && /^[a-z0-9_]{1,60}$/.test(code)
    ? code
    : "sync_execution_failed";
}

async function recordUnexpectedFailure(db, errorCode) {
  const now = new Date().toISOString();
  const run = await db.prepare(`
    SELECT run_id
    FROM ozon_api_sync_runs
    WHERE period_start = ?
      AND period_end = ?
      AND source = ?
      AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `).bind(TEST_DATE, TEST_DATE, SOURCE).first();

  if (run?.run_id) {
    await db.prepare(`
      UPDATE ozon_api_sync_runs
      SET status = 'failed',
          error_code = ?,
          finished_at = ?
      WHERE run_id = ?
        AND status = 'running'
    `).bind(errorCode, now, run.run_id).run();
  } else {
    await db.prepare(`
      INSERT INTO ozon_api_sync_runs (
        run_id,
        source,
        period_start,
        period_end,
        status,
        error_code,
        started_at,
        finished_at
      )
      VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      SOURCE,
      TEST_DATE,
      TEST_DATE,
      errorCode,
      now,
      now
    ).run();
  }

  await db.prepare(`
    INSERT INTO ozon_api_sync_state (
      sync_date,
      source,
      status,
      last_id,
      page_count,
      record_count,
      page_complete,
      reconciled,
      last_error_code,
      last_started_at,
      last_completed_at
    )
    VALUES (?, ?, 'failed', '', 0, 0, 0, 0, ?, ?, ?)
    ON CONFLICT(sync_date) DO UPDATE SET
      status = 'failed',
      page_complete = 0,
      last_error_code = excluded.last_error_code,
      last_completed_at = excluded.last_completed_at,
      updated_at = CURRENT_TIMESTAMP
  `).bind(TEST_DATE, SOURCE, errorCode, now, now).run();
}

async function executeClaimedSync(env, claim) {
  try {
    return await syncOzonFinance(env, {
      dates: [claim.date],
      maxPagesPerDay: claim.maxPages
    });
  } catch (error) {
    const errorCode = safeErrorCode(error);
    try {
      await recordUnexpectedFailure(env.OZON_FINANCE_DB, errorCode);
      return { status: "failed", errorCode };
    } catch {
      return {
        status: "failed",
        errorCode: "sync_result_unavailable"
      };
    }
  }
}

function safeCount(value, field) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid ${field}`);
  }
  return count;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function dashboardRange(periodStart, periodEnd) {
  if (periodStart === undefined && periodEnd === undefined) {
    const dates = getOzonDateWindow();
    return [dates[0], dates[dates.length - 1]];
  }

  if (!validDate(periodStart) || !validDate(periodEnd) ||
      periodStart > periodEnd) {
    throw new Error("invalid_dashboard_period");
  }

  const start = Date.parse(`${periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${periodEnd}T00:00:00.000Z`);
  const dayCount = Math.floor((end - start) / 86400000) + 1;
  if (dayCount > MAX_DASHBOARD_DAYS) {
    throw new Error("dashboard_period_too_large");
  }

  return [periodStart, periodEnd];
}

function dateList(start, end) {
  const dates = [];
  for (
    let timestamp = Date.parse(`${start}T00:00:00.000Z`);
    timestamp <= Date.parse(`${end}T00:00:00.000Z`);
    timestamp += 86400000
  ) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}

function addCalendarDays(value, days = 1) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function finiteInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`invalid_${field}`);
  }
  return number;
}

function logRecentSyncStage(stage) {
  console.info("Ozon recent sync RPC", { stage });
}

function logRecentSyncProbeStage(stage) {
  console.info("Ozon recent sync read-only probe", { stage });
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("sync_probe_timeout")),
        timeoutMs
      );
    })
  ]).finally(() => clearTimeout(timeoutId));
}

export default class OzonFinanceSyncWorker extends WorkerEntrypoint {
  async fetch() {
    return new Response(null, { status: 404 });
  }

  async getManualSyncReadiness() {
    const probe = await this.getRecentSyncReadOnlyProbe();
    if (probe.status !== "ready") {
      const errorCode = probe.errorCode === "sync_probe_database_unavailable"
        ? "database_unavailable"
        : probe.errorCode === "sync_probe_context_unavailable"
          ? "background_sync_unavailable"
          : "sync_readiness_unavailable";
      return {
        ready: false,
        activeRun: false,
        errorCode,
        readOnlyProbe: probe
      };
    }

    if (!this.env.OZON_FINANCE_DB) {
      return {
        ready: false,
        activeRun: false,
        errorCode: "database_unavailable",
        readOnlyProbe: probe
      };
    }
    if (!this.env.OZON_CLIENT_ID || !this.env.OZON_API_KEY) {
      return {
        ready: false,
        activeRun: false,
        errorCode: "ozon_credentials_missing",
        readOnlyProbe: probe
      };
    }
    if (typeof this.ctx?.waitUntil !== "function") {
      return {
        ready: false,
        activeRun: false,
        errorCode: "background_sync_unavailable",
        readOnlyProbe: probe
      };
    }

    try {
      logRecentSyncProbeStage("readiness_lock_select_start");
      const lock = await this.env.OZON_FINANCE_DB.prepare(`
        SELECT CASE
          WHEN lock_token IS NOT NULL
            AND datetime(locked_until) > CURRENT_TIMESTAMP
          THEN 1 ELSE 0
        END AS active
        FROM ozon_api_sync_lock
        WHERE lock_id = 1
      `).first();
      logRecentSyncProbeStage("readiness_lock_select_success");
      const activeRun = lock?.active === 1;
      return {
        ready: !activeRun,
        activeRun,
        errorCode: null,
        readOnlyProbe: probe
      };
    } catch {
      logRecentSyncProbeStage("readiness_lock_select_error");
      return {
        ready: false,
        activeRun: false,
        errorCode: "sync_readiness_unavailable",
        readOnlyProbe: probe
      };
    }
  }

  async getRecentSyncReadOnlyProbe() {
    let lockToken;
    let db;

logRecentSyncProbeStage("A_calculation_start");

let failedStep = "date_window";

try {
  getOzonDateWindow();
  logRecentSyncProbeStage("A_date_ok");

  failedStep = "first_uuid";
  crypto.randomUUID();
  logRecentSyncProbeStage("A_uuid1_ok");

  failedStep = "lock_uuid";
  lockToken = crypto.randomUUID();
  logRecentSyncProbeStage("A_uuid2_ok");

  logRecentSyncProbeStage("A_calculation_success");
} catch (error) {
  console.error("Ozon probe A failure", {
    failedStep,
    errorName: error?.name ?? "Unknown",
    errorMessage: error?.message ?? "No message"
  });

  logRecentSyncProbeStage("A_calculation_error");

  return {
    status: "unavailable",
    lastSuccessfulStage: null,
    failedStage: "A",
    errorCode: "sync_probe_calculation_failed"
  };
}


    logRecentSyncProbeStage("B_binding_start");
    try {
      db = this.env?.OZON_FINANCE_DB;
      const waitUntilAvailable =
        typeof this.ctx?.waitUntil === "function";
      if (!db || typeof db.prepare !== "function") {
        logRecentSyncProbeStage("B_binding_unavailable");
        return {
          status: "unavailable",
          lastSuccessfulStage: "A",
          failedStage: "B",
          errorCode: "sync_probe_database_unavailable"
        };
      }
      if (!waitUntilAvailable) {
        logRecentSyncProbeStage("B_context_unavailable");
        return {
          status: "unavailable",
          lastSuccessfulStage: "A",
          failedStage: "B",
          errorCode: "sync_probe_context_unavailable"
        };
      }
      logRecentSyncProbeStage("B_binding_success");
    } catch {
      logRecentSyncProbeStage("B_binding_error");
      return {
        status: "unavailable",
        lastSuccessfulStage: "A",
        failedStage: "B",
        errorCode: "sync_probe_binding_unavailable"
      };
    }

    logRecentSyncProbeStage("C_select_start");
    try {
      const result = await withTimeout(
        db.prepare("SELECT 1 AS probe").first(),
        SYNC_PROBE_TIMEOUT_MS
      );
      if (result?.probe !== 1) {
        logRecentSyncProbeStage("C_select_invalid");
        return {
          status: "unavailable",
          lastSuccessfulStage: "B",
          failedStage: "C",
          errorCode: "sync_probe_select_failed"
        };
      }
      logRecentSyncProbeStage("C_select_success");
    } catch (error) {
      const timedOut = error?.message === "sync_probe_timeout";
      logRecentSyncProbeStage(
        timedOut ? "C_select_timeout" : "C_select_error"
      );
      return {
        status: "unavailable",
        lastSuccessfulStage: "B",
        failedStage: "C",
        errorCode: timedOut
          ? "sync_probe_timeout"
          : "sync_probe_select_failed"
      };
    }

    let statement;
    logRecentSyncProbeStage("D_prepare_start");
    try {
      statement = db.prepare(RECENT_SYNC_LOCK_SQL);
      logRecentSyncProbeStage("D_prepare_success");
    } catch {
      logRecentSyncProbeStage("D_prepare_error");
      return {
        status: "unavailable",
        lastSuccessfulStage: "C",
        failedStage: "D_prepare",
        errorCode: "sync_probe_prepare_failed"
      };
    }

    logRecentSyncProbeStage("D_bind_start");
    try {
      statement.bind(lockToken);
      logRecentSyncProbeStage("D_bind_success");
    } catch {
      logRecentSyncProbeStage("D_bind_error");
      return {
        status: "unavailable",
        lastSuccessfulStage: "D_prepare",
        failedStage: "D_bind",
        errorCode: "sync_probe_bind_failed"
      };
    }

    logRecentSyncProbeStage("probe_complete");
    return {
      status: "ready",
      lastSuccessfulStage: "D_bind",
      failedStage: null,
      errorCode: null
    };
  }

  async getFinanceDashboard(periodStart, periodEnd) {
    const db = this.env.OZON_FINANCE_DB;
    if (!db) throw new Error("Finance database unavailable");

    const [start, end] = dashboardRange(periodStart, periodEnd);
    const [
      dailyResult,
      categoryResult,
      operationsResult,
      latestRun,
      lastSuccessfulRun,
      types,
      reconciliationResult
    ] = await Promise.all([
        db.prepare(`
          SELECT
            state.sync_date,
            state.status,
            state.page_count,
            state.record_count,
            state.page_complete,
            state.reconciled,
            state.last_error_code,
            state.last_started_at,
            state.last_completed_at,
            COUNT(accrual.accrual_id) AS actual_record_count,
            COALESCE(SUM(accrual.total_kopecks), 0) AS total_kopecks,
            COALESCE(SUM(CASE WHEN accrual.total_kopecks > 0
              THEN accrual.total_kopecks ELSE 0 END), 0) AS positive_kopecks,
            COALESCE(SUM(CASE WHEN accrual.total_kopecks < 0
              THEN accrual.total_kopecks ELSE 0 END), 0) AS negative_kopecks,
            COALESCE(SUM(CASE WHEN accrual.total_kopecks > 0
              THEN 1 ELSE 0 END), 0) AS positive_count,
            COALESCE(SUM(CASE WHEN accrual.total_kopecks < 0
              THEN 1 ELSE 0 END), 0) AS negative_count
          FROM ozon_api_sync_state AS state
          LEFT JOIN ozon_api_accruals AS accrual
            ON accrual.operation_date = state.sync_date
           AND accrual.source = ?
          WHERE state.sync_date >= ?
            AND state.sync_date <= ?
            AND state.source = ?
          GROUP BY state.sync_date
          ORDER BY state.sync_date
        `).bind(SOURCE, start, end, SOURCE).all(),
        db.prepare(`
          SELECT accrued_category, COUNT(*) AS record_count,
                 SUM(total_kopecks) AS total_kopecks,
                 SUM(CASE WHEN total_kopecks > 0
                   THEN total_kopecks ELSE 0 END) AS positive_kopecks,
                 SUM(CASE WHEN total_kopecks < 0
                   THEN total_kopecks ELSE 0 END) AS negative_kopecks,
                 SUM(CASE WHEN total_kopecks > 0 THEN 1 ELSE 0 END)
                   AS positive_count,
                 SUM(CASE WHEN total_kopecks < 0 THEN 1 ELSE 0 END)
                   AS negative_count
          FROM ozon_api_accruals
          WHERE source = ? AND operation_date >= ? AND operation_date <= ?
          GROUP BY accrued_category
          ORDER BY accrued_category
        `).bind(SOURCE, start, end).all(),
        db.prepare(`
          SELECT accrual_id, operation_date, period, accrued_category,
                 unit_number, total_kopecks, reconciled, updated_at
          FROM ozon_api_accruals
          WHERE source = ? AND operation_date >= ? AND operation_date <= ?
          ORDER BY operation_date DESC, accrual_id
          LIMIT ?
        `).bind(
          SOURCE,
          start,
          end,
          MAX_DASHBOARD_OPERATIONS + 1
        ).all(),
        db.prepare(`
          SELECT run_id, status, period_start, period_end,
                 page_count, record_count, retry_count, types_synced,
                 error_code, started_at, finished_at
          FROM ozon_api_sync_runs
          WHERE source = ? AND period_start <= ? AND period_end >= ?
            AND status != 'skipped'
          ORDER BY started_at DESC
          LIMIT 1
        `).bind(SOURCE, end, start).first(),
        db.prepare(`
          SELECT finished_at
          FROM ozon_api_sync_runs
          WHERE source = ?
            AND period_start <= ?
            AND period_end >= ?
            AND status = 'complete'
            AND finished_at IS NOT NULL
          ORDER BY finished_at DESC
          LIMIT 1
        `).bind(SOURCE, end, start).first(),
        db.prepare(`
          SELECT type_id, name, description
          FROM ozon_api_accrual_types
        `).all(),
        db.prepare(`
          SELECT operation_date, net_status, detail_status,
                 detail_reason, verified_at
          FROM ozon_api_reconciliation_audit AS audit
          WHERE source = ?
            AND operation_date >= ?
            AND operation_date <= ?
          ORDER BY verified_at DESC
        `).bind(SOURCE, start, end).all()
      ]);

    const stateByDate = new Map(
      (dailyResult.results || []).map(row => [row.sync_date, row])
    );
    const discrepancyResult = await db.prepare(`
      SELECT accrual.operation_date, COUNT(*) AS discrepancy_count
      FROM ozon_api_accrual_discrepancies AS discrepancy
      JOIN ozon_api_accruals AS accrual
        ON accrual.accrual_id = discrepancy.accrual_id
      WHERE accrual.source = ?
        AND accrual.operation_date >= ?
        AND accrual.operation_date <= ?
        AND discrepancy.status = 'open'
      GROUP BY accrual.operation_date
    `).bind(SOURCE, start, end).all();
    const discrepanciesByDate = new Map(
      (discrepancyResult.results || []).map(row => [
        row.operation_date,
        safeCount(row.discrepancy_count, "discrepancy_count")
      ])
    );
    const reconciliationByDate = new Map();
    for (const audit of reconciliationResult.results || []) {
      if (!reconciliationByDate.has(audit.operation_date)) {
        reconciliationByDate.set(audit.operation_date, audit);
      }
    }

    const daily = dateList(start, end).map(date => {
      const row = stateByDate.get(date);
      if (!row) {
        const audit = reconciliationByDate.get(date);
        return {
          date,
          status: "not_started",
          pageCount: 0,
          recordCount: null,
          totalKopecks: null,
          positiveKopecks: null,
          negativeKopecks: null,
          positiveCount: null,
          negativeCount: null,
          complete: false,
          reconciled: false,
          netStatus: audit?.net_status || "unverified",
          detailStatus: audit?.detail_status || "unverified",
          detailReason: audit?.detail_reason ||
            "official_report_not_registered",
          discrepancyCount: discrepanciesByDate.get(date) || 0,
          errorCode: null,
          startedAt: null,
          completedAt: null
        };
      }

      const audit = reconciliationByDate.get(date);
      const reconciled = row.reconciled === 1 &&
        !discrepanciesByDate.has(date);
      return {
        date,
        status: row.status,
        pageCount: safeCount(row.page_count, "page_count"),
        recordCount: safeCount(row.actual_record_count, "record_count"),
        totalKopecks: finiteInteger(row.total_kopecks, "total_kopecks"),
        positiveKopecks: finiteInteger(
          row.positive_kopecks,
          "positive_kopecks"
        ),
        negativeKopecks: finiteInteger(
          row.negative_kopecks,
          "negative_kopecks"
        ),
        positiveCount: safeCount(row.positive_count, "positive_count"),
        negativeCount: safeCount(row.negative_count, "negative_count"),
        complete: row.page_complete === 1,
        reconciled,
        netStatus: reconciled ? "verified" : audit?.net_status ||
          "unverified",
        detailStatus: audit?.detail_status || "unverified",
        detailReason: audit?.detail_reason ||
          "official_report_not_registered",
        discrepancyCount: discrepanciesByDate.get(date) || 0,
        errorCode: row.last_error_code || null,
        startedAt: row.last_started_at || null,
        completedAt: row.last_completed_at || null
      };
    });

    const rawOperations = operationsResult.results || [];
    const truncated = rawOperations.length > MAX_DASHBOARD_OPERATIONS;
    const operations = rawOperations.slice(0, MAX_DASHBOARD_OPERATIONS);
    const componentMap = new Map();
    if (operations.length) {
      const componentResult = await db.prepare(`
        SELECT component.accrual_id, component.sku, component.type_id,
               component.amount_kopecks
        FROM ozon_api_accrual_components AS component
        WHERE component.accrual_id IN (
          SELECT accrual_id
          FROM ozon_api_accruals
          WHERE source = ?
            AND operation_date >= ?
            AND operation_date <= ?
          ORDER BY operation_date DESC, accrual_id
          LIMIT ?
        )
        ORDER BY component.accrual_id, component.sku, component.type_id
      `).bind(
        SOURCE,
        start,
        end,
        MAX_DASHBOARD_OPERATIONS
      ).all();
      for (const component of componentResult.results || []) {
        const key = component.accrual_id;
        const current = componentMap.get(key) || [];
        current.push({
          sku: String(component.sku),
          typeId: safeCount(component.type_id, "type_id"),
          typeName: types.results?.find(
            type => type.type_id === component.type_id
          )?.name || "Неизвестный тип",
          amountKopecks: finiteInteger(
            component.amount_kopecks,
            "component_amount"
          )
        });
        componentMap.set(key, current);
      }
    }

    const totalKopecks = categories => categories.reduce(
      (sum, category) =>
        sum + finiteInteger(category.total_kopecks, "category_total"),
      0
    );
    const positiveKopecks = daily.reduce(
      (sum, row) => sum + row.positiveKopecks,
      0
    );
    const negativeKopecks = daily.reduce(
      (sum, row) => sum + row.negativeKopecks,
      0
    );
    const hasCompleteDay = daily.some(day => day.complete);

    return {
      source: SOURCE,
      currency: "RUB",
      periodStart: start,
      periodEnd: end,
      fetchedAt: new Date().toISOString(),
      lastSuccessfulAt: lastSuccessfulRun?.finished_at || null,
      componentVerification: {
        status: "unverified",
        reason: "ozon_api_component_mapping_incomplete"
      },
      coverage: {
        days: daily.length,
        completeDays: daily.filter(day => day.complete).length,
        reconciledDays: daily.filter(day => day.reconciled).length
      },
      totals: {
        recordCount: hasCompleteDay
          ? safeCount(
              (categoryResult.results || []).reduce(
                (sum, category) => sum + Number(category.record_count),
                0
              ),
              "total_record_count"
            )
          : null,
        totalKopecks: hasCompleteDay
          ? totalKopecks(categoryResult.results || [])
          : null,
        positiveKopecks: hasCompleteDay ? positiveKopecks : null,
        negativeKopecks: hasCompleteDay ? negativeKopecks : null,
        positiveCount: hasCompleteDay
          ? daily.reduce((sum, day) => sum + day.positiveCount, 0)
          : null,
        negativeCount: hasCompleteDay
          ? daily.reduce((sum, day) => sum + day.negativeCount, 0)
          : null
      },
      daily,
      categories: (categoryResult.results || []).map(row => ({
        category: row.accrued_category,
        recordCount: safeCount(row.record_count, "category_record_count"),
        totalKopecks: finiteInteger(row.total_kopecks, "category_total"),
        positiveKopecks: finiteInteger(
          row.positive_kopecks,
          "category_positive_kopecks"
        ),
        negativeKopecks: finiteInteger(
          row.negative_kopecks,
          "category_negative_kopecks"
        ),
        positiveCount: safeCount(
          row.positive_count,
          "category_positive_count"
        ),
        negativeCount: safeCount(
          row.negative_count,
          "category_negative_count"
        )
      })),
      operations: operations.map(row => ({
        accrualId: row.accrual_id,
        date: row.operation_date,
        period: row.period,
        category: row.accrued_category,
        unitNumber: row.unit_number,
        totalKopecks: finiteInteger(row.total_kopecks, "total_kopecks"),
        reconciled: row.reconciled === 1 &&
          !discrepanciesByDate.has(row.operation_date),
        updatedAt: row.updated_at,
        components: componentMap.get(row.accrual_id) || []
      })),
      truncated,
      latestRun: latestRun
        ? {
            runId: latestRun.run_id,
            status: latestRun.status,
            periodStart: latestRun.period_start,
            periodEnd: latestRun.period_end,
            pageCount: safeCount(latestRun.page_count, "run_page_count"),
            recordCount: safeCount(
              latestRun.record_count,
              "run_record_count"
            ),
            retryCount: safeCount(
              latestRun.retry_count,
              "run_retry_count"
            ),
            typesSynced: latestRun.types_synced === 1,
            errorCode: latestRun.error_code || null,
            startedAt: latestRun.started_at,
            finishedAt: latestRun.finished_at
          }
        : null
    };
  }

  async startRecentSync() {
    logRecentSyncStage("entry");
    if (!this.env.OZON_FINANCE_DB) {
      logRecentSyncStage("database_unavailable");
      return { status: "unavailable", errorCode: "database_unavailable" };
    }
    if (typeof this.ctx?.waitUntil !== "function") {
      logRecentSyncStage("wait_until_unavailable");
      return { status: "unavailable", errorCode: "background_sync_unavailable" };
    }

    const dates = getOzonDateWindow();
    const runId = crypto.randomUUID();
    const lockToken = crypto.randomUUID();
    const db = this.env.OZON_FINANCE_DB;
    let lock;
    logRecentSyncStage("lock_await_start");
    try {
      lock = await db.prepare(RECENT_SYNC_LOCK_SQL)
        .bind(lockToken)
        .first();
      logRecentSyncStage("lock_await_end");
    } catch {
      logRecentSyncStage("lock_await_error");
      return {
        status: "unavailable",
        errorCode: "sync_lock_unavailable"
      };
    }

    if (!lock) {
      logRecentSyncStage("lock_busy");
      return {
        status: "rejected",
        errorCode: "sync_already_running"
      };
    }

    try {
      logRecentSyncStage("run_insert_await_start");
      await db.prepare(`
        INSERT INTO ozon_api_sync_runs (
          run_id,
          source,
          period_start,
          period_end,
          status,
          started_at
        )
        VALUES (?, ?, ?, ?, 'running', ?)
      `).bind(
        runId,
        SOURCE,
        dates[0],
        dates[dates.length - 1],
        new Date().toISOString()
      ).run();
      logRecentSyncStage("run_insert_await_end");
    } catch {
      logRecentSyncStage("run_insert_await_error");
      try {
        logRecentSyncStage("run_insert_lock_release_await_start");
        await db.prepare(`
          UPDATE ozon_api_sync_lock
          SET lock_token = NULL,
              locked_until = '1970-01-01 00:00:00'
          WHERE lock_id = 1 AND lock_token = ?
        `).bind(lockToken).run();
        logRecentSyncStage("run_insert_lock_release_await_end");
      } catch {
        logRecentSyncStage("run_insert_lock_release_await_error");
        return {
          status: "unavailable",
          errorCode: "sync_lock_cleanup_failed"
        };
      }
      return {
        status: "unavailable",
        errorCode: "sync_run_unavailable"
      };
    }

    let startBackgroundTask;
    const backgroundTask = new Promise(resolve => {
      startBackgroundTask = resolve;
    });

    try {
      logRecentSyncStage("wait_until_register_start");
      this.ctx.waitUntil(backgroundTask);
      logRecentSyncStage("wait_until_register_end");
    } catch {
      logRecentSyncStage("wait_until_register_error");
      try {
        logRecentSyncStage("wait_until_cleanup_await_start");
        await db.batch([
          db.prepare(`
            UPDATE ozon_api_sync_runs
            SET status = 'failed',
                error_code = 'background_sync_unavailable',
                finished_at = ?
            WHERE run_id = ? AND status = 'running'
          `).bind(new Date().toISOString(), runId),
          db.prepare(`
            UPDATE ozon_api_sync_lock
            SET lock_token = NULL,
                locked_until = '1970-01-01 00:00:00'
            WHERE lock_id = 1 AND lock_token = ?
          `).bind(lockToken)
        ]);
        logRecentSyncStage("wait_until_cleanup_await_end");
      } catch {
        logRecentSyncStage("wait_until_cleanup_await_error");
        startBackgroundTask();
        return {
          status: "unavailable",
          errorCode: "sync_schedule_cleanup_failed"
        };
      }
      startBackgroundTask();
      return {
        status: "unavailable",
        errorCode: "background_sync_unavailable"
      };
    }

    logRecentSyncStage("background_task_start");
    startBackgroundTask(
      syncOzonFinance(this.env, {
        dates,
        runId,
        lockToken,
        runAlreadyCreated: true
      }).catch(async error => {
        const errorCode = safeErrorCode(error);
        const finishedAt = new Date().toISOString();
        try {
          await db.batch([
            db.prepare(`
              UPDATE ozon_api_sync_runs
              SET status = 'failed',
                  error_code = ?,
                  finished_at = ?
              WHERE run_id = ? AND status = 'running'
            `).bind(errorCode, finishedAt, runId),
            db.prepare(`
              UPDATE ozon_api_sync_state
              SET status = 'failed',
                  page_complete = 0,
                  last_error_code = ?,
                  last_completed_at = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE source = ?
                AND sync_date >= ?
                AND sync_date <= ?
                AND status = 'running'
            `).bind(errorCode, finishedAt, SOURCE, dates[0], dates.at(-1))
          ]);
        } catch {
          console.error("Ozon sync failure could not be recorded", {
            runId,
            errorCode: "sync_result_unavailable"
          });
        }
        console.error("Ozon scheduled sync failed", {
          runId,
          errorCode
        });
      })
    );
    logRecentSyncStage("rpc_return");
    return {
      status: "started",
      runId,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1]
    };
  }

  async prepareOctoberBackfill(jobId, maxDatesPerRun = 1) {
    const db = this.env.OZON_FINANCE_DB;
    if (!db) return { status: "unavailable", errorCode: "database_unavailable" };
    if (
      typeof jobId !== "string" ||
      !/^ozon-oct-2026-[a-z0-9-]{1,32}$/.test(jobId) ||
      !Number.isInteger(maxDatesPerRun) ||
      maxDatesPerRun < 1 ||
      maxDatesPerRun > 3
    ) {
      return { status: "rejected", errorCode: "invalid_backfill_job" };
    }

    await db.prepare(`
      INSERT INTO ozon_api_backfill_state (
        job_id, period_start, period_end, next_date, status,
        max_dates_per_run
      )
      VALUES (?, ?, ?, ?, 'prepared', ?)
      ON CONFLICT(job_id) DO NOTHING
    `).bind(
      jobId,
      OCTOBER_BACKFILL_START,
      OCTOBER_BACKFILL_END,
      OCTOBER_BACKFILL_START,
      maxDatesPerRun
    ).run();

    const job = await db.prepare(`
      SELECT job_id, period_start, period_end, next_date, status,
             max_dates_per_run
      FROM ozon_api_backfill_state
      WHERE job_id = ?
    `).bind(jobId).first();
    if (
      !job ||
      job.period_start !== OCTOBER_BACKFILL_START ||
      job.period_end !== OCTOBER_BACKFILL_END ||
      Number(job.max_dates_per_run) !== maxDatesPerRun
    ) {
      return { status: "rejected", errorCode: "backfill_job_conflict" };
    }

    return {
      status: job.status,
      jobId: job.job_id,
      nextDate: job.next_date,
      maxDatesPerRun: job.max_dates_per_run
    };
  }

  async runBackfillBatch(jobId) {
    const db = this.env.OZON_FINANCE_DB;
    if (!db) return { status: "unavailable", errorCode: "database_unavailable" };
    if (
      typeof jobId !== "string" ||
      !/^ozon-oct-2026-[a-z0-9-]{1,32}$/.test(jobId)
    ) {
      return { status: "rejected", errorCode: "invalid_backfill_job" };
    }

    const lockToken = crypto.randomUUID();
    const job = await db.prepare(`
      UPDATE ozon_api_backfill_state
      SET status = 'running',
          lock_token = ?,
          locked_until = datetime('now', '+15 minutes'),
          last_error_code = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
        AND period_start = ?
        AND period_end = ?
        AND (
          status IN ('prepared', 'paused', 'failed')
          OR (
            status = 'running'
            AND datetime(locked_until) <= CURRENT_TIMESTAMP
          )
        )
      RETURNING job_id, period_start, period_end, next_date,
                max_dates_per_run
    `).bind(
      lockToken,
      jobId,
      OCTOBER_BACKFILL_START,
      OCTOBER_BACKFILL_END
    ).first();

    if (!job) {
      return {
        status: "rejected",
        errorCode: "backfill_job_busy_or_unavailable"
      };
    }

    const runId = crypto.randomUUID();
    const dates = dateList(job.next_date, job.period_end)
      .slice(0, safeCount(job.max_dates_per_run, "max_dates_per_run"));
    await db.prepare(`
      INSERT INTO ozon_api_backfill_runs (
        backfill_run_id, job_id, period_start, period_end,
        status, started_at
      )
      VALUES (?, ?, ?, ?, 'running', ?)
    `).bind(
      runId,
      jobId,
      dates[0],
      dates[dates.length - 1],
      new Date().toISOString()
    ).run();

    let result;
    try {
      result = await syncOzonFinance(this.env, {
        dates,
        maxPagesPerDay: MAX_BACKFILL_PAGES_PER_DAY
      });
    } catch (error) {
      result = {
        status: "failed",
        errorCode: safeErrorCode(error),
        pageCount: 0,
        recordCount: 0
      };
    }

    const stateResult = await db.prepare(`
      SELECT sync_date, status, page_complete
      FROM ozon_api_sync_state
      WHERE source = ? AND sync_date >= ? AND sync_date <= ?
      ORDER BY sync_date
    `).bind(SOURCE, dates[0], dates[dates.length - 1]).all();
    const stateByDate = new Map(
      (stateResult.results || []).map(row => [row.sync_date, row])
    );
    let nextDate = job.next_date;
    let completedDates = 0;
    for (const date of dates) {
      const state = stateByDate.get(date);
      if (state?.status !== "complete" || state.page_complete !== 1) break;
      completedDates++;
      nextDate = addCalendarDays(date);
    }
    const allHistoryComplete = nextDate > job.period_end;
    const backfillStatus = allHistoryComplete
      ? "complete"
      : result.status === "failed" && completedDates === 0
        ? "failed"
        : "paused";
    const runStatus = result.status === "skipped"
      ? "skipped"
      : result.status === "failed" && completedDates === 0
        ? "failed"
        : completedDates === dates.length
          ? "complete"
          : "partial";
    const storedNextDate = allHistoryComplete
      ? job.period_end
      : nextDate;
    const errorCode = result.errorCode || null;
    const finishedAt = new Date().toISOString();

    await db.batch([
      db.prepare(`
        UPDATE ozon_api_backfill_runs
        SET status = ?, pages = ?, records = ?, error_code = ?,
            finished_at = ?
        WHERE backfill_run_id = ? AND job_id = ? AND status = 'running'
      `).bind(
        runStatus,
        safeCount(result.pageCount || 0, "backfill_page_count"),
        safeCount(result.recordCount || 0, "backfill_record_count"),
        errorCode,
        finishedAt,
        runId,
        jobId
      ),
      db.prepare(`
        UPDATE ozon_api_backfill_state
        SET next_date = ?,
            status = ?,
            last_run_id = ?,
            last_error_code = ?,
            lock_token = NULL,
            locked_until = '1970-01-01 00:00:00',
            updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ? AND status = 'running' AND lock_token = ?
      `).bind(
        storedNextDate,
        backfillStatus,
        runId,
        errorCode,
        jobId,
        lockToken
      )
    ]);

    return {
      status: backfillStatus,
      jobId,
      runId,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      nextDate: storedNextDate,
      completedDates,
      pageCount: safeCount(result.pageCount || 0, "backfill_page_count"),
      recordCount: safeCount(result.recordCount || 0, "backfill_record_count"),
      errorCode
    };
  }

  async scheduled(controller) {
    if (controller?.cron !== DAILY_CRON) {
      return { status: "ignored", errorCode: "unexpected_schedule" };
    }
    const scheduledTime = Number(controller.scheduledTime);
    if (!Number.isFinite(scheduledTime)) {
      return { status: "failed", errorCode: "invalid_scheduled_time" };
    }
    return syncOzonFinance(this.env, {
      dates: getOzonDateWindow(new Date(scheduledTime))
    });
  }

  async startOneShotSync() {
    if (
      !this.env.OZON_FINANCE_DB ||
      this.env.OZON_FINANCE_SYNC_TEST_DATE !== TEST_DATE ||
      Number(this.env.OZON_FINANCE_SYNC_TEST_MAX_PAGES) !== TEST_MAX_PAGES
    ) {
      return {
        status: "unavailable",
        errorCode: "controlled_test_configuration_required"
      };
    }

    let claim;
    try {
      claim = await claimOzonOneShotGate(
        this.env.OZON_FINANCE_DB,
        { date: TEST_DATE, maxPages: TEST_MAX_PAGES }
      );
    } catch {
      return {
        status: "unavailable",
        errorCode: "one_shot_gate_unavailable"
      };
    }

    if (!claim) {
      return {
        status: "rejected",
        errorCode: "one_shot_gate_not_armed_or_already_claimed"
      };
    }

    const result = await executeClaimedSync(this.env, claim);
    return {
      status: result.status,
      date: claim.date,
      maxPages: claim.maxPages,
      pageCount: safeCount(result.pageCount || 0, "page count"),
      recordCount: safeCount(result.recordCount || 0, "record count"),
      retryCount: safeCount(result.retryCount || 0, "retry count"),
      typesSynced: result.typesSynced === true,
      errorCode: safeErrorCode(result.errorCode)
    };
  }

  async getOneShotSyncResult() {
    const db = this.env.OZON_FINANCE_DB;
    if (!db) throw new Error("Finance database unavailable");

    const [gate, run, state, totals] = await Promise.all([
      db.prepare(`
        SELECT sync_date, max_pages, status, claimed_at
        FROM ozon_api_one_shot_gate
        WHERE gate_id = 1
      `).first(),
      db.prepare(`
        SELECT
          status,
          page_count,
          record_count,
          retry_count,
          types_synced,
          error_code,
          started_at,
          finished_at
        FROM ozon_api_sync_runs
        WHERE period_start = ?
          AND period_end = ?
          AND source = ?
        ORDER BY started_at DESC
        LIMIT 1
      `).bind(TEST_DATE, TEST_DATE, SOURCE).first(),
      db.prepare(`
        SELECT
          status,
          page_count,
          record_count,
          page_complete,
          reconciled,
          last_error_code,
          last_started_at,
          last_completed_at
        FROM ozon_api_sync_state
        WHERE sync_date = ?
          AND source = ?
      `).bind(TEST_DATE, SOURCE).first(),
      db.prepare(`
        SELECT
          COUNT(*) AS record_count,
          COUNT(DISTINCT accrual_id) AS unique_count,
          COALESCE(SUM(total_kopecks), 0) AS total_kopecks
        FROM ozon_api_accruals
        WHERE operation_date = ?
          AND source = ?
      `).bind(TEST_DATE, SOURCE).first()
    ]);

    if (
      !gate ||
      gate.sync_date !== TEST_DATE ||
      Number(gate.max_pages) !== TEST_MAX_PAGES ||
      !["disarmed", "armed", "claimed"].includes(gate.status)
    ) {
      throw new Error("One-shot gate state unavailable");
    }

    const recordCount = safeCount(totals?.record_count, "record count");
    const uniqueCount = safeCount(totals?.unique_count, "unique count");
    const totalKopecks = Number(totals?.total_kopecks);
    if (
      !Number.isSafeInteger(totalKopecks) ||
      uniqueCount > recordCount
    ) {
      throw new Error("Finance result is out of range");
    }

    const status = run?.status || state?.status ||
      (gate.status === "claimed" ? "running" : "not_started");

    return {
      date: TEST_DATE,
      maxPages: TEST_MAX_PAGES,
      gateStatus: gate.status,
      claimed: gate.status === "claimed" && Boolean(gate.claimed_at),
      status,
      run: run
        ? {
            status: run.status,
            pageCount: safeCount(run.page_count, "page count"),
            recordCount: safeCount(run.record_count, "run record count"),
            retryCount: safeCount(run.retry_count, "retry count"),
            typesSynced: run.types_synced === 1,
            errorCode: run.error_code || null,
            startedAt: run.started_at,
            finishedAt: run.finished_at
          }
        : null,
      state: state
        ? {
            status: state.status,
            pageCount: safeCount(state.page_count, "state page count"),
            recordCount: safeCount(state.record_count, "state record count"),
            complete: state.page_complete === 1,
            reconciled: state.reconciled === 1,
            errorCode: state.last_error_code || null,
            startedAt: state.last_started_at,
            finishedAt: state.last_completed_at
          }
        : null,
      accruals: {
        count: recordCount,
        uniqueCount,
        duplicateCount: recordCount - uniqueCount,
        totalKopecks
      },
      currency: "RUB",
      reconciled: false
    };
  }
}
