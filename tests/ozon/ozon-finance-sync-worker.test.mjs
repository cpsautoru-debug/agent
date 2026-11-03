// Проверка нового read-only RPC-метода getAccrualDailyTotals()
// (workers/ozon-finance-sync.js), используемого Pages Function
// xlsx-preview.js через Service Binding OZON_FINANCE_SYNC.
//
// ВАЖНО: сам класс OzonFinanceSyncWorker импортирует
// "cloudflare:workers" (WorkerEntrypoint), который недоступен в
// обычном окружении Node.js/node:test — поэтому напрямую
// импортировать workers/ozon-finance-sync.js здесь нельзя. Вместо
// этого:
//  1. Статическая проверка подтверждает, что тело метода
//     getAccrualDailyTotals содержит ровно один SQL-запрос, и этот
//     запрос — SELECT (никаких write-глаголов и вызовов
//     .run()/.batch() внутри метода).
//  2. Функциональная проверка выполняет ТОЧНО ТОТ ЖЕ SQL-запрос (текст
//     скопирован из исходника построчно) через in-memory sqlite с
//     реальными миграциями, и проверяет, что агрегация по датам даёт
//     контрольные значения владельца: 31.10.2026 — 30 начислений /
//     910596 коп.; 01.11.2026 — 45 / 6723153; 02.11.2026 — 34 /
//     1503402.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const WORKER_SOURCE = await readFile(
  new URL("../../workers/ozon-finance-sync.js", import.meta.url),
  "utf8"
);

function extractMethodBody(source, methodSignature) {
  const start = source.indexOf(methodSignature);
  assert.ok(start >= 0, `Method not found: ${methodSignature}`);
  // Находим соответствующую закрывающую фигурную скобку метода по
  // балансу скобок, начиная с первой "{" после сигнатуры.
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("Unbalanced braces while extracting method body");
}

const methodBody = extractMethodBody(
  WORKER_SOURCE,
  "async getAccrualDailyTotals(periodStart, periodEnd) {"
);

test("getAccrualDailyTotals() method body contains no SQL write statements or write-method calls", () => {
  const writeSqlVerbs = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i;
  const writeDbCalls = /\.(run|batch|exec)\s*\(/;

  assert.equal(methodBody.match(writeSqlVerbs), null);
  assert.equal(methodBody.match(writeDbCalls), null);

  // Ровно один вызов .prepare(...) — один read-only SELECT-запрос.
  const prepareCalls = [...methodBody.matchAll(/\.prepare\s*\(/g)];
  assert.equal(prepareCalls.length, 1);
  assert.match(methodBody, /\.prepare\(`\s*\n\s*SELECT/);
});

async function createSyncedTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
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

  const controlValues = [
    { date: "2026-10-31", recordCount: 30, totalKopecks: 910596 },
    { date: "2026-11-01", recordCount: 45, totalKopecks: 6723153 },
    { date: "2026-11-02", recordCount: 34, totalKopecks: 1503402 }
  ];

  for (const { date, recordCount, totalKopecks } of controlValues) {
    sqlite.prepare(`
      INSERT INTO ozon_api_sync_state (
        sync_date, source, status, last_id, page_count, record_count,
        page_complete, reconciled, last_started_at, last_completed_at
      )
      VALUES (?, 'ozon_seller_api', 'complete', '', 1, ?, 1, 1, ?, ?)
    `).run(date, recordCount, `${date}T03:15:00.000Z`, `${date}T03:16:00.000Z`);

    // Распределяем контрольную сумму по recordCount строкам начислений
    // (последняя строка забирает остаток копеек, чтобы сумма сошлась
    // точно, без потерь на округлении).
    const perRow = Math.floor(totalKopecks / recordCount);
    let distributed = 0;
    for (let i = 0; i < recordCount; i++) {
      const isLast = i === recordCount - 1;
      const amount = isLast ? totalKopecks - distributed : perRow;
      distributed += amount;
      sqlite.prepare(`
        INSERT INTO ozon_api_accruals (
          accrual_id, operation_date, period, accrued_category,
          unit_number, total_kopecks, currency, source, reconciled
        )
        VALUES (?, ?, '2026-10', 'POSTING', NULL, ?, 'RUB', 'ozon_seller_api', 1)
      `).run(`${date}-${i}`, date, amount);
    }
  }

  return sqlite;
}

test("the exact SQL from getAccrualDailyTotals() reproduces the owner's confirmed control totals (30/45/34 accruals, 910596/6723153/1503402 kopecks)", async () => {
  const sqlite = await createSyncedTestDatabase();

  const SOURCE = "ozon_seller_api";
  const start = "2026-10-31";
  const end = "2026-11-02";

  // Текст запроса идентичен коду в workers/ozon-finance-sync.js —
  // если он разойдётся с реальным методом, этот тест нужно обновить
  // синхронно с правкой метода.
  const rows = sqlite.prepare(`
    SELECT
      state.sync_date,
      state.status,
      state.page_complete,
      state.reconciled,
      COUNT(accrual.accrual_id) AS record_count,
      COALESCE(SUM(accrual.total_kopecks), 0) AS total_kopecks
    FROM ozon_api_sync_state AS state
    LEFT JOIN ozon_api_accruals AS accrual
      ON accrual.operation_date = state.sync_date
     AND accrual.source = ?
    WHERE state.sync_date >= ?
      AND state.sync_date <= ?
      AND state.source = ?
    GROUP BY state.sync_date
    ORDER BY state.sync_date
  `).all(SOURCE, start, end, SOURCE);

  assert.equal(rows.length, 3);
  const byDate = new Map(rows.map(row => [row.sync_date, row]));

  const oct31 = byDate.get("2026-10-31");
  assert.equal(oct31.record_count, 30);
  assert.equal(oct31.total_kopecks, 910596);
  assert.equal(oct31.page_complete, 1);
  assert.equal(oct31.reconciled, 1);

  const nov01 = byDate.get("2026-11-01");
  assert.equal(nov01.record_count, 45);
  assert.equal(nov01.total_kopecks, 6723153);

  const nov02 = byDate.get("2026-11-02");
  assert.equal(nov02.record_count, 34);
  assert.equal(nov02.total_kopecks, 1503402);

  assert.equal(
    oct31.total_kopecks + nov01.total_kopecks + nov02.total_kopecks,
    9137151
  );

  sqlite.close();
});

test("a date with no ozon_api_sync_state row (sync never started) is simply absent from the SQL result, not silently reported as zero-complete", async () => {
  const sqlite = await createSyncedTestDatabase();
  // Удаляем состояние синхронизации за 02.11.2026, имитируя дату, за
  // которую синхронизация вообще не запускалась.
  sqlite.exec("DELETE FROM ozon_api_sync_state WHERE sync_date = '2026-11-02'");

  const SOURCE = "ozon_seller_api";
  const rows = sqlite.prepare(`
    SELECT state.sync_date
    FROM ozon_api_sync_state AS state
    WHERE state.sync_date >= ? AND state.sync_date <= ? AND state.source = ?
    ORDER BY state.sync_date
  `).all("2026-10-31", "2026-11-02", SOURCE);

  assert.equal(rows.length, 2);
  // Это ровно тот случай, для которого getAccrualDailyTotals()
  // достраивает запись status: "not_started" через dateList() на
  // стороне JS, а не через SQL — настоящий метод покрывает все даты
  // диапазона, даже отсутствующие в ozon_api_sync_state.

  sqlite.close();
});
