// Безопасный Preview-импорт официального отчёта Ozon
// "Отчет по начислениям_<период>.xlsx".
//
// ЭТОТ МОДУЛЬ НИКОГДА НЕ ВЫПОЛНЯЕТ INSERT/UPDATE/DELETE И НЕ ПИШЕТ
// В D1. Единственное обращение к базе — потенциальное чтение (SELECT)
// для сверки с начислениями Seller API; см. compareAgainstApiAccruals.
import { parseWorkbookXlsx, XlsxParseError } from "./xlsx-parser.js";
import {
  extractAccrualOperations,
  ReportFormatError
} from "./ozon-accrual-report.js";
import { classifyOperation, classifyScope, CATEGORY } from "./xlsx-classifier.js";

export const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const API_SOURCE = "ozon_seller_api";

export class XlsxImportError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "XlsxImportError";
    this.code = code;
    this.details = details;
  }
}

function assertZipMagic(bytes) {
  if (
    bytes.length < ZIP_MAGIC.length ||
    ZIP_MAGIC.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new XlsxImportError("xlsx_invalid_file_signature");
  }
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Сравнение КЛАССИФИЦИРОВАННЫХ строк файла с начислениями Seller API.
// НИКАКОГО прямого доступа к D1 отсюда: единственный канал — RPC
// Service Binding на тестовый Worker (см. env.OZON_FINANCE_SYNC в
// xlsx-preview.js и getAccrualDailyTotals() в
// workers/ozon-finance-sync.js), который сам читает тестовую D1
// (autosklad63-ozon-finance-sync-test) и отдаёт ТОЛЬКО агрегаты по
// датам. Раньше здесь ошибочно принимался параметр `db`, который на
// практике был Pages-биндингом OZON_FINANCE_DB — это совершенно
// другая D1 (используется исключительно для проверки роли owner,
// таблица office_authorized_users), в ней нет и не должно быть
// таблицы ozon_api_accruals. Эта архитектурная ошибка исправлена:
// функция больше не принимает и не использует "db" вообще.
//
// ВАЖНО (подтверждено на реальном файле): колонка "ID начисления" в
// XLSX НЕ является accrual_id Ozon Seller API (её значения — номер
// отправления, ID рекламной кампании, строка периода отчёта или
// пусто, в зависимости от типа начисления) — поэтому построчное
// (поэлементное) сопоставление с API здесь не выполняется вовсе.
// Совпадение по сумме само по себе тоже никогда не считается
// доказательством совпадения операций. Поэтому сравнение ведётся
// ТОЛЬКО по агрегатам за дату (сумма файла против суммы API).
//
// ВАЖНО (подтверждено владельцем на реальной тестовой D1): три факта
// про день — это ТРИ НЕЗАВИСИМЫХ признака, их нельзя схлопывать в
// один булев флаг:
//   1) apiLoadComplete — загрузка начислений API за день завершена
//      (page_complete=1, т.е. флаг syncComplete от Worker'а) И это
//      подтверждается количеством загруженных записей, а не только
//      самим флагом status/page_complete (если по факту начислений в
//      API ноль, а в Excel за этот день есть строки — такую
//      "complete"-загрузку доверять нельзя).
//   2) совпадение сумм Excel и API за день (differenceKopecks === 0).
//   3) reconciled — прошла ли ФОРМАЛЬНАЯ сверка (отдельный аудит,
//      отличный от простого совпадения сумм). reconciled=0 означает
//      ТОЛЬКО "формальная сверка ещё не подтверждена" — это НЕ
//      признак незавершённой загрузки API и не повод показывать
//      ошибку. Поэтому день с apiLoadComplete=true, совпадающими
//      суммами и reconciled=0 получает отдельный статус
//      "amounts_match_pending_formal_reconciliation", а не
//      "api_sync_incomplete" и не "amounts_match_reconciled".
// Разница количества строк Excel и количества начислений API
// (детализация одной операции несколькими строками) ожидаема и не
// считается ошибкой: сравниваются только суммы.
export async function compareAgainstApiAccrualTotals(
  financeSyncService,
  operations
) {
  const dates = [...new Set(operations.map(op => op.operationDate))].sort();

  if (dates.length === 0) {
    return {
      comparedDates: [],
      byDate: [],
      identifierConfidence: "no_operations_to_compare",
      note: "amount_equality_alone_is_not_treated_as_a_match"
    };
  }

  const periodStart = dates[0];
  const periodEnd = dates[dates.length - 1];

  const response = await financeSyncService.getAccrualDailyTotals(
    periodStart,
    periodEnd
  );

  if (
    !response ||
    typeof response !== "object" ||
    response.source !== API_SOURCE ||
    !Array.isArray(response.daily)
  ) {
    throw new XlsxImportError("xlsx_api_comparison_invalid_response");
  }

  const apiByDate = new Map();
  for (const row of response.daily) {
    if (
      !row ||
      typeof row.operationDate !== "string" ||
      !Number.isSafeInteger(row.recordCount) ||
      row.recordCount < 0 ||
      !Number.isSafeInteger(row.totalKopecks) ||
      typeof row.syncComplete !== "boolean" ||
      typeof row.reconciled !== "boolean"
    ) {
      throw new XlsxImportError("xlsx_api_comparison_invalid_response");
    }
    apiByDate.set(row.operationDate, row);
  }

  const fileByDate = new Map();
  for (const operation of operations) {
    const entry = fileByDate.get(operation.operationDate) || {
      count: 0,
      totalKopecks: 0
    };
    entry.count += 1;
    entry.totalKopecks += operation.amountKopecks;
    fileByDate.set(operation.operationDate, entry);
  }

  const byDate = dates.map(date => {
    const file = fileByDate.get(date);
    const api = apiByDate.get(date) || null;
    const apiDataAvailable = api !== null;

    // Признак 1: загрузка завершена. page_complete=1 (api.syncComplete)
    // сам по себе не считается достаточным доказательством — он
    // дополнительно сверяется с фактическим количеством загруженных
    // записей: если за день, по которому в Excel есть операции,
    // API сообщает 0 записей, такую загрузку доверенной не считаем,
    // даже если флаг "complete" установлен.
    const apiLoadComplete = apiDataAvailable &&
      api.syncComplete &&
      (api.recordCount > 0 || file.count === 0);

    const differenceKopecks = apiDataAvailable
      ? file.totalKopecks - api.totalKopecks
      : null;

    // Признак 2: совпадение сумм — имеет смысл только если загрузка
    // подтверждённо завершена (иначе сравнивать не с чем).
    const amountsMatch = apiLoadComplete && differenceKopecks === 0;

    // Признак 3: формальная сверка (reconciled) — независимый аудит,
    // ОТДЕЛЬНЫЙ от совпадения сумм. reconciled=false означает только
    // "аудит ещё не подтверждён", а не "загрузка не завершена" и не
    // "суммы не совпадают".
    const formallyReconciled = apiDataAvailable && api.reconciled;

    let status;
    if (!apiDataAvailable) {
      status = "no_api_data_for_date";
    } else if (!apiLoadComplete) {
      status = "api_sync_incomplete";
    } else if (differenceKopecks !== 0) {
      status = "amount_mismatch";
    } else if (formallyReconciled) {
      status = "amounts_match_reconciled";
    } else {
      status = "amounts_match_pending_formal_reconciliation";
    }

    return {
      operationDate: date,
      fileRowCount: file.count,
      fileTotalKopecks: file.totalKopecks,
      apiRecordCount: apiDataAvailable ? api.recordCount : null,
      apiTotalKopecks: apiDataAvailable ? api.totalKopecks : null,
      apiLoadComplete,
      apiReconciled: apiDataAvailable ? api.reconciled : false,
      amountsMatch,
      differenceKopecks,
      status
    };
  });

  return {
    comparedDates: dates,
    byDate,
    identifierConfidence: "aggregate_only_no_row_level_matching",
    note: "amount_equality_alone_is_not_treated_as_a_match"
  };
}

function buildAggregations(classifiedOperations) {
  const byDate = new Map();
  const byCategory = new Map();
  let totalKopecks = 0;
  let positiveKopecks = 0;
  let negativeKopecks = 0;
  let unknownCount = 0;

  for (const operation of classifiedOperations) {
    totalKopecks += operation.amountKopecks;
    if (operation.amountKopecks >= 0) {
      positiveKopecks += operation.amountKopecks;
    } else {
      negativeKopecks += operation.amountKopecks;
    }
    if (operation.category === CATEGORY.UNKNOWN) unknownCount++;

    const dateEntry = byDate.get(operation.operationDate) || {
      operationDate: operation.operationDate,
      totalKopecks: 0,
      count: 0
    };
    dateEntry.totalKopecks += operation.amountKopecks;
    dateEntry.count += 1;
    byDate.set(operation.operationDate, dateEntry);

    const categoryEntry = byCategory.get(operation.category) || {
      category: operation.category,
      totalKopecks: 0,
      count: 0,
      scope: { sku: 0, order: 0, shop: 0 }
    };
    categoryEntry.totalKopecks += operation.amountKopecks;
    categoryEntry.count += 1;
    categoryEntry.scope[operation.scope] += 1;
    byCategory.set(operation.category, categoryEntry);
  }

  return {
    byDate: [...byDate.values()].sort(
      (a, b) => a.operationDate.localeCompare(b.operationDate)
    ),
    byCategory: [...byCategory.values()].sort((a, b) => b.count - a.count),
    totalKopecks,
    positiveKopecks,
    negativeKopecks,
    unknownCount
  };
}

// Итоговый статус сверки по всему отчёту — вычисляется строго по
// данным, вернувшимся из getAccrualDailyTotals(), и ЧЕСТНО различает
// три независимых факта (загрузка завершена / суммы совпадают /
// формальная сверка подтверждена), вместо их схлопывания в один
// булев флаг:
//  - если хотя бы за один день нет данных API вовсе — явный статус
//    "нет данных", не маскируется под "сверено";
//  - если хотя бы за один день загрузка API реально не завершена
//    (включая кросс-проверку количества загруженных записей, а не
//    только флага complete) — явный статус "загрузка не завершена";
//  - если хотя бы за один день суммы Excel и API расходятся —
//    явный статус "расхождение сумм", требует ручного разбора;
//  - если по всем дням суммы совпали, но формальная сверка (reconciled)
//    хотя бы за один день ещё не подтверждена — отдельный статус
//    "суммы совпадают, формальная сверка не подтверждена" — это НЕ
//    ошибка и НЕ финальное подтверждение, а честное промежуточное
//    состояние;
//  - полностью подтверждённым считается отчёт только если ПО ВСЕМ
//    дням загрузка завершена, суммы совпали И формальная сверка уже
//    пройдена.
function computeReconciliationStatus(apiComparison) {
  if (!apiComparison) return "api_comparison_skipped_no_service_binding";
  if (apiComparison.comparedDates.length === 0) {
    return "no_operations_to_compare";
  }
  if (apiComparison.byDate.some(day => day.status === "no_api_data_for_date")) {
    return "no_api_data_for_some_dates";
  }
  if (apiComparison.byDate.some(day => day.status === "api_sync_incomplete")) {
    return "api_sync_incomplete_for_some_dates";
  }
  if (apiComparison.byDate.some(day => day.status === "amount_mismatch")) {
    return "amount_mismatch_requires_manual_confirmation";
  }
  if (
    apiComparison.byDate.some(
      day => day.status === "amounts_match_pending_formal_reconciliation"
    )
  ) {
    return "amounts_match_pending_formal_reconciliation";
  }
  return "amounts_match_confirmed_sync_complete";
}

// Главная точка входа. Возвращает отчёт Preview; НИКОГДА не пишет в
// БД и не обращается к D1 напрямую. `financeSyncService` —
// необязательный RPC Service Binding (env.OZON_FINANCE_SYNC) на
// тестовый Worker autosklad63-ozon-sync-worker-test, у которого
// нужен только read-only метод getAccrualDailyTotals(). Если
// биндинг не передан или не предоставляет этот метод, сверка с API
// просто пропускается (reconciliationStatus это явно отражает) —
// сам парсинг и классификация файла при этом продолжают работать.
export async function buildXlsxImportPreview({
  fileBytes,
  fileName,
  financeSyncService
}) {
  if (!(fileBytes instanceof Uint8Array)) {
    throw new XlsxImportError("xlsx_invalid_payload");
  }
  if (fileBytes.byteLength === 0) {
    throw new XlsxImportError("xlsx_empty_file");
  }
  if (fileBytes.byteLength > MAX_REPORT_BYTES) {
    throw new XlsxImportError("xlsx_file_too_large", {
      maxBytes: MAX_REPORT_BYTES
    });
  }
  if (typeof fileName !== "string" || !/\.xlsx$/i.test(fileName.trim())) {
    throw new XlsxImportError("xlsx_invalid_file_name");
  }
  assertZipMagic(fileBytes);

  const sha256 = await sha256Hex(fileBytes);

  let workbook;
  try {
    workbook = await parseWorkbookXlsx(fileBytes);
  } catch (error) {
    if (error instanceof XlsxParseError) {
      throw new XlsxImportError("xlsx_parse_failed", { cause: error.code });
    }
    throw error;
  }

  const sheet = workbook.sheets.find(
    candidate => /начислен/i.test(candidate.name || "")
  ) || workbook.sheets[0];

  let extraction;
  try {
    extraction = extractAccrualOperations(sheet.rows);
  } catch (error) {
    if (error instanceof ReportFormatError) {
      throw new XlsxImportError("xlsx_report_format_invalid", {
        cause: error.code,
        details: error.details
      });
    }
    throw error;
  }

  const classifiedOperations = extraction.operations.map(operation => {
    const category = classifyOperation(operation);
    return {
      ...operation,
      category,
      scope: classifyScope(operation, category)
    };
  });

  const aggregates = buildAggregations(classifiedOperations);

  const classificationCompleteness = classifiedOperations.length > 0
    ? Number((
      ((classifiedOperations.length - aggregates.unknownCount) /
        classifiedOperations.length) * 100
    ).toFixed(2))
    : 0;

  const controlTotalStatus = extraction.declaredTotalKopecks === null
    ? "not_declared_in_report"
    : extraction.declaredTotalKopecks === aggregates.totalKopecks
      ? "matches_computed_sum"
      : "mismatch";

  const apiComparisonAvailable = !!financeSyncService &&
    typeof financeSyncService.getAccrualDailyTotals === "function";
  const apiComparison = apiComparisonAvailable
    ? await compareAgainstApiAccrualTotals(
      financeSyncService,
      classifiedOperations
    )
    : null;

  return {
    status: "preview_only",
    writesPerformed: false,
    insertStatementsExecuted: 0,
    source: {
      fileName: fileName.trim(),
      sha256,
      sizeBytes: fileBytes.byteLength,
      sheetName: sheet.name || null,
      headerRowNumber: extraction.headerRowNumber,
      recognizedColumns: extraction.recognizedColumns,
      detailRows: classifiedOperations.length,
      skippedBlankRows: extraction.skippedBlankRows,
      duplicateRows: extraction.duplicates
    },
    totals: {
      totalKopecks: aggregates.totalKopecks,
      positiveKopecks: aggregates.positiveKopecks,
      negativeKopecks: aggregates.negativeKopecks,
      declaredTotalKopecks: extraction.declaredTotalKopecks,
      controlTotalStatus
    },
    byDate: aggregates.byDate,
    byCategory: aggregates.byCategory,
    classification: {
      totalOperations: classifiedOperations.length,
      unknownCount: aggregates.unknownCount,
      completenessPercent: classificationCompleteness
    },
    reconciliationStatus: computeReconciliationStatus(apiComparison),
    apiComparison,
    operations: classifiedOperations
  };
}
