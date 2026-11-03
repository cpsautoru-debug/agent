import assert from "node:assert/strict";
import test from "node:test";
import { importModule } from "./load-module.mjs";

const { detectHeaderRow, extractAccrualOperations, parseAmountToKopecks, ReportFormatError } =
  await importModule(
    import.meta.url,
    "../../functions/api/ozon/ozon-accrual-report.js"
  );

function cellRow(rowNumber, values) {
  return {
    rowNumber,
    cells: values.map(value => value === null ? undefined : { type: "s", value })
  };
}

test("parseAmountToKopecks handles comma decimals and thousands separators", () => {
  assert.equal(parseAmountToKopecks("9 105,96"), 910596);
  assert.equal(parseAmountToKopecks("-316,33"), -31633);
  assert.equal(parseAmountToKopecks("28000"), 2800000);
  assert.equal(parseAmountToKopecks("not a number"), null);
});

test("detectHeaderRow finds header among known Ozon column aliases", () => {
  const rows = [
    cellRow(1, ["Отчет по начислениям за период"]),
    cellRow(2, ["Дата начисления", "Тип начисления", "Итого, руб.", "Номер отправления"])
  ];
  const header = detectHeaderRow(rows);
  assert.ok(header);
  assert.equal(header.rowIndex, 1);
  assert.equal(header.columns.date, 0);
  assert.equal(header.columns.serviceName, 1);
  assert.equal(header.columns.amount, 2);
  assert.equal(header.columns.postingNumber, 3);
});

test("detectHeaderRow returns null when required columns are missing", () => {
  const rows = [cellRow(1, ["Произвольный заголовок без нужных колонок"])];
  assert.equal(detectHeaderRow(rows), null);
});

test("detectHeaderRow and extractAccrualOperations recognize the real 'Группа услуг' column and use it as a classification signal", () => {
  // Колонка из реального отчёта "Отчет по начислениям_31.10.2026-02.11.2026.xlsx";
  // используется как резервный (fallback) признак классификации, когда
  // ключевые слова в "Типе начисления" не совпали ни с одним правилом.
  const rows = [
    cellRow(1, ["Дата начисления", "Группа услуг", "Тип начисления", "Итого, руб."]),
    cellRow(2, ["31.10.2026", "Продажи", "Выручка", 49691.61])
  ];
  const header = detectHeaderRow(rows);
  assert.ok(header);
  assert.equal(header.columns.serviceGroup, 1);

  const result = extractAccrualOperations(rows);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].serviceGroup, "Продажи");
});

test("extractAccrualOperations extracts rows, skips blanks and total row", () => {
  const rows = [
    cellRow(1, ["Дата начисления", "Тип начисления", "Итого, руб.", "Номер отправления", "Артикул"]),
    cellRow(2, ["31.10.2026", "Аналитика Plus", -28000, null, null]),
    cellRow(3, [null, null, null, null, null]),
    cellRow(4, ["31.10.2026", "Логистика", -163.07, "12345-0001-1", "SKU-1"]),
    cellRow(5, ["Итого", null, -28163.07, null, null])
  ];

  const result = extractAccrualOperations(rows);
  assert.equal(result.operations.length, 2);
  assert.equal(result.skippedBlankRows, 1);
  assert.equal(result.declaredTotalKopecks, -2816307);

  const [first, second] = result.operations;
  assert.equal(first.operationDate, "2026-10-31");
  assert.equal(first.serviceName, "Аналитика Plus");
  assert.equal(first.amountKopecks, -2800000);
  assert.equal(first.postingNumber, null);

  assert.equal(second.postingNumber, "12345-0001-1");
  assert.equal(second.sku, "SKU-1");
  assert.equal(second.amountKopecks, -16307);
});

test("extractAccrualOperations flags duplicate rows without dropping them silently", () => {
  const rows = [
    cellRow(1, ["Дата начисления", "Тип начисления", "Итого, руб."]),
    cellRow(2, ["31.10.2026", "Логистика", -100]),
    cellRow(3, ["31.10.2026", "Логистика", -100])
  ];
  const result = extractAccrualOperations(rows);
  assert.equal(result.operations.length, 2);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].rowNumber, 3);
  assert.equal(result.duplicates[0].duplicateOfRow, 2);
});

test("extractAccrualOperations throws on a row with unparsable amount", () => {
  const rows = [
    cellRow(1, ["Дата начисления", "Тип начисления", "Итого, руб."]),
    cellRow(2, ["31.10.2026", "Логистика", "см. комментарий"])
  ];
  assert.throws(
    () => extractAccrualOperations(rows),
    error => error instanceof ReportFormatError &&
      error.code === "ozon_report_row_invalid"
  );
});

test("extractAccrualOperations throws when no header row is recognized", () => {
  const rows = [cellRow(1, ["Случайный текст"])];
  assert.throws(
    () => extractAccrualOperations(rows),
    error => error instanceof ReportFormatError &&
      error.code === "ozon_report_header_not_found"
  );
});
