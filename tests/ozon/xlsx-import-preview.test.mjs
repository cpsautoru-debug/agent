import assert from "node:assert/strict";
import test from "node:test";
import { importModule } from "./load-module.mjs";
import { buildXlsxBuffer } from "./xlsx-fixtures.mjs";

const {
  buildXlsxImportPreview,
  compareAgainstApiAccrualTotals,
  XlsxImportError,
  MAX_REPORT_BYTES
} = await importModule(
  import.meta.url,
  "../../functions/api/ozon/xlsx-import-preview.js"
);

// Синтетический набор строк соответствует контрольным суммам,
// указанным владельцем для 31.10.2026-02.11.2026 (9 105,96 / 67 231,53
// / 15 034,02 ₽, итого 91 371,51 ₽). Это тестовая фикстура, а не
// результат разбора реального файла — реальный .xlsx отсутствует в
// рабочей области и должен быть провалидирован отдельно.
// Сумма "Реализация товара" за 31.10.2026 (49 691,61 ₽) подобрана так,
// чтобы итог дня совпал с подтверждённой контрольной суммой
// 9 105,96 ₽ (-28000 -6990 -3890.40 -716.33 -704.50 -163.07 -121.35
// +49691.61 = 9105.96). Это синтетическая фикстура для проверки
// арифметики агрегации, а не данные реального отчёта.
const SHEET_ROWS = [
  ["Дата начисления", "Тип начисления", "Итого, руб.", "Номер отправления", "Артикул"],
  ["31.10.2026", "Аналитика Plus", -28000, null, null],
  ["31.10.2026", "Premium Plus", -6990, null, null],
  ["31.10.2026", "Продвижение за заказ", -3890.40, "74268714-0275-1", null],
  ["31.10.2026", "Реклама за клики", -716.33, null, "SKU-1"],
  ["31.10.2026", "Реклама за клики", -704.50, null, "SKU-2"],
  ["31.10.2026", "Логистика, нерекомендованный слот", -163.07, "74268714-0275-1", null],
  ["31.10.2026", "Размещение на складе", -121.35, null, null],
  ["31.10.2026", "Реализация товара", 49691.61, "74268714-0275-1", "SKU-1"],
  ["01.11.2026", "Реализация товара", 67231.53, "10000000-0001-1", "SKU-1"],
  ["02.11.2026", "Реализация товара", 15034.02, "10000000-0002-1", "SKU-2"],
  ["Итого", null, 91371.51, null, null]
];

function buildReportBuffer() {
  return new Uint8Array(buildXlsxBuffer({ rows: SHEET_ROWS }));
}

// Мок Service Binding'а на тестовый Worker
// (autosklad63-ozon-sync-worker-test). ЕДИНСТВЕННЫЙ допустимый способ
// получить начисления API из Pages Function — вызов этого RPC-метода;
// никакого прямого доступа к D1 здесь и в продакшн-коде больше нет.
function createMockFinanceSyncService(dailyByDate) {
  const calls = [];
  return {
    calls,
    async getAccrualDailyTotals(periodStart, periodEnd) {
      calls.push([periodStart, periodEnd]);
      return {
        source: "ozon_seller_api",
        currency: "RUB",
        periodStart,
        periodEnd,
        daily: Object.entries(dailyByDate).map(([operationDate, entry]) => ({
          operationDate,
          recordCount: entry.recordCount,
          totalKopecks: entry.totalKopecks,
          syncComplete: entry.syncComplete,
          reconciled: entry.reconciled
        }))
      };
    }
  };
}

test("buildXlsxImportPreview parses, classifies and aggregates without touching any database", async () => {
  const financeSyncService = createMockFinanceSyncService({
    "2026-10-31": {
      recordCount: 30, totalKopecks: 910596, syncComplete: true, reconciled: true
    },
    "2026-11-01": {
      recordCount: 45, totalKopecks: 6723153, syncComplete: true, reconciled: true
    },
    "2026-11-02": {
      recordCount: 34, totalKopecks: 1503402, syncComplete: true, reconciled: true
    }
  });

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "Отчет по начислениям_31.10.2026-02.11.2026.xlsx",
    financeSyncService
  });

  assert.equal(preview.status, "preview_only");
  assert.equal(preview.writesPerformed, false);
  assert.equal(preview.insertStatementsExecuted, 0);

  assert.equal(preview.source.detailRows, 10);
  assert.equal(preview.source.duplicateRows.length, 0);
  assert.match(preview.source.sha256, /^[0-9a-f]{64}$/);

  const byDate = new Map(preview.byDate.map(entry => [entry.operationDate, entry]));
  assert.equal(byDate.get("2026-10-31").totalKopecks, 910596);
  assert.equal(byDate.get("2026-11-01").totalKopecks, 6723153);
  assert.equal(byDate.get("2026-11-02").totalKopecks, 1503402);

  assert.equal(preview.totals.totalKopecks, 910596 + 6723153 + 1503402);

  const byCategory = new Map(
    preview.byCategory.map(entry => [entry.category, entry])
  );
  assert.ok(byCategory.has("SUBSCRIPTION"));
  assert.equal(byCategory.get("SUBSCRIPTION").count, 2);
  assert.ok(byCategory.has("ADS_CPC"));
  assert.equal(byCategory.get("ADS_CPC").count, 2);
  assert.ok(byCategory.has("PROMOTION_PER_ORDER"));
  assert.ok(byCategory.has("WAREHOUSE_SERVICES"));
  assert.ok(byCategory.has("SALE"));

  assert.equal(preview.classification.unknownCount, 0);
  assert.equal(preview.classification.completenessPercent, 100);

  // getAccrualDailyTotals вызван ровно один раз, с диапазоном,
  // покрывающим все даты файла (минимальный read-only запрос, а не
  // построчный обход).
  assert.equal(financeSyncService.calls.length, 1);
  assert.deepEqual(financeSyncService.calls[0], ["2026-10-31", "2026-11-02"]);

  assert.ok(preview.apiComparison);
  assert.equal(preview.apiComparison.identifierConfidence, "aggregate_only_no_row_level_matching");
  assert.equal(preview.reconciliationStatus, "amounts_match_confirmed_sync_complete");

  const apiByDate = new Map(
    preview.apiComparison.byDate.map(entry => [entry.operationDate, entry])
  );
  const oct31 = apiByDate.get("2026-10-31");
  assert.equal(oct31.status, "amounts_match_reconciled");
  assert.equal(oct31.apiLoadComplete, true);
  assert.equal(oct31.amountsMatch, true);
  assert.equal(oct31.apiReconciled, true);
  assert.equal(oct31.differenceKopecks, 0);
  // Количество строк Excel (8 операций за 31.10) и количество
  // начислений API (30, из контрольных значений владельца) сознательно
  // РАЗНЫЕ — это не является ошибкой и не влияет на статус.
  assert.notEqual(oct31.fileRowCount, oct31.apiRecordCount);

  // Опасные поля прежней (ошибочной) архитектуры не должны
  // возвращаться вовсе: они заявляли о построчном/ID-совпадении,
  // которое не может быть доказано.
  assert.equal("apiRowCount" in preview.apiComparison, false);
  assert.equal("possibleMatchesByComposite" in preview.apiComparison, false);
  assert.equal("matchedByAccrualId" in preview.apiComparison, false);
  assert.equal("rowLevelMatchingAvailable" in preview.apiComparison, false);
});

test("REGRESSION: architecture bug — buildXlsxImportPreview must never query a raw D1 binding for API accruals", async () => {
  // Ранее функция ошибочно принимала `db` (в проде — Pages-биндинг
  // OZON_FINANCE_DB, предназначенный только для проверки роли owner в
  // office_authorized_users) и выполняла по нему SELECT из
  // ozon_api_accruals — таблицы, которой там нет и быть не должно.
  // Теперь единственный допустимый источник сверки — RPC
  // financeSyncService.getAccrualDailyTotals(). Любой объект без
  // этого метода (в т.ч. "похожий на D1" объект с .prepare()) должен
  // просто означать "сверка недоступна", а не провоцировать попытку
  // SQL-запроса к чужой базе.
  let prepareCalled = false;
  const wrongBindingLookingLikeD1 = {
    prepare() {
      prepareCalled = true;
      throw new Error("must never be called: this is the owner-auth D1, not the finance sync D1");
    }
  };

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "report.xlsx",
    financeSyncService: wrongBindingLookingLikeD1
  });

  assert.equal(prepareCalled, false);
  assert.equal(preview.apiComparison, null);
  assert.equal(preview.reconciliationStatus, "api_comparison_skipped_no_service_binding");
});

test("REGRESSION: a day is never reported as a confirmed match when the API load for that day is genuinely incomplete, even if the sums happen to match", async () => {
  const financeSyncService = createMockFinanceSyncService({
    "2026-10-31": {
      // Суммы совпадают, но синхронизация за день ещё не завершена —
      // день не должен считаться подтверждённо сверенным.
      recordCount: 12, totalKopecks: 910596, syncComplete: false, reconciled: false
    },
    "2026-11-01": {
      recordCount: 45, totalKopecks: 6723153, syncComplete: true, reconciled: true
    },
    "2026-11-02": {
      recordCount: 34, totalKopecks: 1503402, syncComplete: true, reconciled: true
    }
  });

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "report.xlsx",
    financeSyncService
  });

  const apiByDate = new Map(
    preview.apiComparison.byDate.map(entry => [entry.operationDate, entry])
  );
  assert.equal(apiByDate.get("2026-10-31").status, "api_sync_incomplete");
  assert.equal(apiByDate.get("2026-10-31").apiLoadComplete, false);
  assert.equal(preview.reconciliationStatus, "api_sync_incomplete_for_some_dates");
});

test("REGRESSION (owner-confirmed real D1 state): status=complete, page_complete=1, matching sums, reconciled=0 must be reported as 'amounts match, formal reconciliation pending' — NOT as an incomplete-load error, and NOT as a formally confirmed reconciliation", async () => {
  // Подтверждено владельцем на реальной тестовой D1 за 31.10-02.11.2026:
  // status=complete, page_complete=1, record_count=30/45/34, reconciled=0
  // для всех трёх дат. reconciled=0 здесь означает ТОЛЬКО, что
  // формальный аудит ещё не проведён — загрузка при этом полностью
  // завершена, а суммы Excel и API совпадают.
  const financeSyncService = createMockFinanceSyncService({
    "2026-10-31": {
      recordCount: 30, totalKopecks: 910596, syncComplete: true, reconciled: false
    },
    "2026-11-01": {
      recordCount: 45, totalKopecks: 6723153, syncComplete: true, reconciled: false
    },
    "2026-11-02": {
      recordCount: 34, totalKopecks: 1503402, syncComplete: true, reconciled: false
    }
  });

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "report.xlsx",
    financeSyncService
  });

  const apiByDate = new Map(
    preview.apiComparison.byDate.map(entry => [entry.operationDate, entry])
  );
  for (const date of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
    const day = apiByDate.get(date);
    // Загрузка подтверждённо завершена — это НЕ ошибка неполной загрузки.
    assert.equal(day.apiLoadComplete, true, `${date}: load must be reported complete`);
    // Суммы совпадают.
    assert.equal(day.amountsMatch, true, `${date}: amounts must match`);
    assert.equal(day.differenceKopecks, 0);
    // Формальная сверка ещё не подтверждена.
    assert.equal(day.apiReconciled, false, `${date}: reconciled must stay false`);
    // Статус — отдельный, не "api_sync_incomplete" и не "amounts_match_reconciled".
    assert.equal(day.status, "amounts_match_pending_formal_reconciliation");
    assert.notEqual(day.status, "api_sync_incomplete");
    assert.notEqual(day.status, "amounts_match_reconciled");
  }

  // Итоговый статус отчёта: суммы совпадают, но формальная сверка не
  // подтверждена — НЕ "загрузка не завершена" и НЕ "полностью сверено".
  assert.equal(preview.reconciliationStatus, "amounts_match_pending_formal_reconciliation");
  assert.notEqual(preview.reconciliationStatus, "api_sync_incomplete_for_some_dates");
  assert.notEqual(preview.reconciliationStatus, "amounts_match_confirmed_sync_complete");
});

test("REGRESSION: a day with status=complete/page_complete=1 but zero API records while the Excel file has rows for that date is not trusted as a complete load (record-count sanity check, not just the status flag)", async () => {
  const financeSyncService = createMockFinanceSyncService({
    // page_complete=1 ("complete"), но фактическое количество
    // загруженных начислений равно нулю, хотя в Excel за 31.10 есть
    // операции. Доверять одному только флагу "complete" нельзя.
    "2026-10-31": {
      recordCount: 0, totalKopecks: 0, syncComplete: true, reconciled: true
    },
    "2026-11-01": {
      recordCount: 45, totalKopecks: 6723153, syncComplete: true, reconciled: true
    },
    "2026-11-02": {
      recordCount: 34, totalKopecks: 1503402, syncComplete: true, reconciled: true
    }
  });

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "report.xlsx",
    financeSyncService
  });

  const oct31 = preview.apiComparison.byDate.find(
    entry => entry.operationDate === "2026-10-31"
  );
  assert.equal(oct31.apiLoadComplete, false);
  assert.equal(oct31.status, "api_sync_incomplete");
  assert.equal(preview.reconciliationStatus, "api_sync_incomplete_for_some_dates");
});

test("REGRESSION: a day with no API data at all is not silently treated as matching", async () => {
  const financeSyncService = createMockFinanceSyncService({
    "2026-11-01": {
      recordCount: 45, totalKopecks: 6723153, syncComplete: true, reconciled: true
    },
    "2026-11-02": {
      recordCount: 34, totalKopecks: 1503402, syncComplete: true, reconciled: true
    }
    // 2026-10-31 отсутствует в ответе API целиком.
  });

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "report.xlsx",
    financeSyncService
  });

  const apiByDate = new Map(
    preview.apiComparison.byDate.map(entry => [entry.operationDate, entry])
  );
  const oct31 = apiByDate.get("2026-10-31");
  assert.equal(oct31.status, "no_api_data_for_date");
  assert.equal(oct31.apiRecordCount, null);
  assert.equal(oct31.apiTotalKopecks, null);
  assert.equal(oct31.differenceKopecks, null);
  assert.equal(preview.reconciliationStatus, "no_api_data_for_some_dates");
});

test("buildXlsxImportPreview flags an amount mismatch instead of silently accepting it", async () => {
  const financeSyncService = createMockFinanceSyncService({
    "2026-10-31": {
      recordCount: 30, totalKopecks: 1000000, syncComplete: true, reconciled: true
    },
    "2026-11-01": {
      recordCount: 45, totalKopecks: 6723153, syncComplete: true, reconciled: true
    },
    "2026-11-02": {
      recordCount: 34, totalKopecks: 1503402, syncComplete: true, reconciled: true
    }
  });

  const preview = await buildXlsxImportPreview({
    fileBytes: buildReportBuffer(),
    fileName: "report.xlsx",
    financeSyncService
  });

  const apiByDate = new Map(
    preview.apiComparison.byDate.map(entry => [entry.operationDate, entry])
  );
  const oct31 = apiByDate.get("2026-10-31");
  assert.equal(oct31.status, "amount_mismatch");
  assert.equal(oct31.differenceKopecks, 910596 - 1000000);
  assert.equal(preview.reconciliationStatus, "amount_mismatch_requires_manual_confirmation");
});

test("compareAgainstApiAccrualTotals rejects a malformed RPC response instead of trusting it blindly", async () => {
  const malformedService = {
    async getAccrualDailyTotals() {
      return { source: "ozon_seller_api", currency: "RUB", daily: "not-an-array" };
    }
  };

  await assert.rejects(
    () => compareAgainstApiAccrualTotals(malformedService, [
      { operationDate: "2026-10-31", amountKopecks: 100 }
    ]),
    error => error instanceof XlsxImportError &&
      error.code === "xlsx_api_comparison_invalid_response"
  );
});

test("buildXlsxImportPreview surfaces a malformed RPC response as an error rather than a false reconciliation", async () => {
  const malformedService = {
    async getAccrualDailyTotals() {
      return { source: "wrong_source", currency: "RUB", daily: [] };
    }
  };

  await assert.rejects(
    () => buildXlsxImportPreview({
      fileBytes: buildReportBuffer(),
      fileName: "report.xlsx",
      financeSyncService: malformedService
    }),
    error => error instanceof XlsxImportError &&
      error.code === "xlsx_api_comparison_invalid_response"
  );
});

test("buildXlsxImportPreview reports a control-total mismatch instead of silently accepting it", async () => {
  const rows = SHEET_ROWS.slice();
  rows[rows.length - 1] = ["Итого", null, 1, null, null];
  const buffer = new Uint8Array(buildXlsxBuffer({ rows }));

  const preview = await buildXlsxImportPreview({
    fileBytes: buffer,
    fileName: "report.xlsx",
    financeSyncService: null
  });

  assert.equal(preview.totals.controlTotalStatus, "mismatch");
  assert.equal(preview.apiComparison, null);
  assert.equal(preview.reconciliationStatus, "api_comparison_skipped_no_service_binding");
});

test("buildXlsxImportPreview rejects files that are not valid .xlsx archives", async () => {
  await assert.rejects(
    () => buildXlsxImportPreview({
      fileBytes: new Uint8Array([1, 2, 3, 4]),
      fileName: "report.xlsx",
      financeSyncService: null
    }),
    error => error instanceof XlsxImportError &&
      error.code === "xlsx_invalid_file_signature"
  );
});

test("buildXlsxImportPreview rejects files above the size limit", async () => {
  const oversized = new Uint8Array(MAX_REPORT_BYTES + 1);
  await assert.rejects(
    () => buildXlsxImportPreview({
      fileBytes: oversized,
      fileName: "report.xlsx",
      financeSyncService: null
    }),
    error => error instanceof XlsxImportError &&
      error.code === "xlsx_file_too_large"
  );
});

test("buildXlsxImportPreview rejects a non-.xlsx file name", async () => {
  await assert.rejects(
    () => buildXlsxImportPreview({
      fileBytes: buildReportBuffer(),
      fileName: "report.pdf",
      financeSyncService: null
    }),
    error => error instanceof XlsxImportError &&
      error.code === "xlsx_invalid_file_name"
  );
});

test("buildXlsxImportPreview flags duplicate rows without silently deduplicating", async () => {
  const rows = SHEET_ROWS.slice(0, 2);
  rows.push(SHEET_ROWS[1]);
  const buffer = new Uint8Array(buildXlsxBuffer({ rows }));

  const preview = await buildXlsxImportPreview({
    fileBytes: buffer,
    fileName: "report.xlsx",
    financeSyncService: null
  });

  assert.equal(preview.source.detailRows, 2);
  assert.equal(preview.source.duplicateRows.length, 1);
});
