import assert from "node:assert/strict";
import test from "node:test";
import { importModule } from "./load-module.mjs";
import { buildXlsxBuffer } from "./xlsx-fixtures.mjs";

const { parseWorkbookXlsx, readZipEntries, XlsxParseError } =
  await importModule(
    import.meta.url,
    "../../functions/api/ozon/xlsx-parser.js"
  );

test("parseWorkbookXlsx reads shared strings, text and numeric cells", async () => {
  const buffer = buildXlsxBuffer({
    sheetName: "Отчет по начислениям",
    rows: [
      ["Дата", "Услуга", "Сумма"],
      ["31.10.2026", "Логистика", -12345],
      ["31.10.2026", "Логистика", -12345]
    ]
  });

  const workbook = await parseWorkbookXlsx(buffer);
  assert.equal(workbook.sheets.length, 1);
  assert.equal(workbook.sheets[0].name, "Отчет по начислениям");

  const rows = workbook.sheets[0].rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].cells[0].value, "Дата");
  assert.equal(rows[0].cells[1].value, "Услуга");
  assert.equal(rows[0].cells[2].value, "Сумма");
  assert.equal(rows[1].cells[0].value, "31.10.2026");
  assert.equal(rows[1].cells[1].value, "Логистика");
  assert.equal(rows[1].cells[2].value, "-12345");

  // Повторяющаяся строка-близнец должна быть прочитана независимо —
  // дедупликация делается на уровне извлечения операций, а не парсера.
  assert.equal(rows[2].cells[1].value, "Логистика");
});

test("readZipEntries rejects a buffer without a ZIP end-of-central-directory", async () => {
  await assert.rejects(
    () => readZipEntries(new Uint8Array(30)),
    error => error instanceof XlsxParseError &&
      error.code === "xlsx_zip_eocd_not_found"
  );
});

test("parseWorkbookXlsx rejects an archive without xl/workbook.xml", async () => {
  await assert.rejects(
    () => parseWorkbookXlsx(buildEmptyZipWithoutWorkbook()),
    error => error instanceof XlsxParseError &&
      error.code === "xlsx_workbook_missing"
  );
});

function buildEmptyZipWithoutWorkbook() {
  // Крошечный валидный ZIP без записей — имитирует файл, который не
  // является настоящим .xlsx, хотя и начинается с корректной сигнатуры.
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  return eocd;
}
