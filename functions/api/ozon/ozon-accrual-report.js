// Извлечение операций из официального отчёта Ozon
// "Отчет по начислениям_<период>.xlsx".
//
// ВАЖНО: названия колонок ниже — это набор известных/документированных
// вариантов заголовков Ozon. Они НЕ подтверждены на реальном файле
// "Отчет по начислениям_31.10.2026-02.11.2026.xlsx" (файл отсутствует
// в рабочей области). Перед использованием в бою необходимо прогнать
// реальный файл через detectHeaderRow()/extractAccrualOperations() и
// при необходимости дополнить HEADER_ALIASES — код не подставляет
// придуманные значения вместо отсутствующих колонок, а explicit
// бросает ReportFormatError.

export class ReportFormatError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "ReportFormatError";
    this.code = code;
    this.details = details;
  }
}

const REQUIRED_FIELDS = ["date", "serviceName", "amount"];
const MAX_HEADER_SCAN_ROWS = 30;

const HEADER_ALIASES = {
  date: [
    "дата начисления",
    "дата операции",
    "дата"
  ],
  serviceName: [
    "тип начисления",
    "услуга",
    "наименование услуги",
    "статья начисления",
    "статья"
  ],
  amount: [
    "итого, руб.",
    "итого руб.",
    "сумма, руб.",
    "сумма транзакции, руб.",
    "сумма начисления, руб.",
    "сумма"
  ],
  postingNumber: [
    "номер отправления",
    "номер заказа",
    "отправление"
  ],
  sku: [
    "артикул",
    "ozon id",
    "sku"
  ],
  // ВАЖНО (подтверждено на реальном файле "Отчет по начислениям_
  // 31.10.2026-02.11.2026.xlsx"): колонка "ID начисления" НЕ является
  // устойчивым уникальным идентификатором и НЕ подтверждена как
  // совпадающая с accrual_id Ozon Seller API. На реальном файле в
  // этой колонке встречаются: номер отправления в формате
  // "NNNNNNNN-NNNN-N" (или без последнего сегмента), короткий
  // числовой ID рекламной кампании, строка периода отчёта
  // ("30.10.26-30.11.26") для подписок/аналитики, либо пустое
  // значение. Значение извлекается только для отображения в Preview
  // как справочное поле и НИКОГДА не используется для сопоставления
  // с Ozon Seller API (см. xlsx-import-preview.js:
  // compareAgainstApiAccruals).
  operationId: [
    "номер начисления",
    "id начисления",
    "номер операции",
    "id операции"
  ],
  // Официальная группировка статьи ("Группа услуг") — проверенный
  // признак из самого отчёта, используется классификатором как
  // дополнительный (не единственный) сигнал для статей, которые
  // нельзя надёжно распознать по одному только названию.
  serviceGroup: [
    "группа услуг",
    "группа"
  ]
};

function normalizeHeaderText(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return null;
  return typeof cell.value === "string" ? cell.value : String(cell.value);
}

function matchField(normalizedCells, aliases) {
  for (let i = 0; i < normalizedCells.length; i++) {
    if (normalizedCells[i] && aliases.includes(normalizedCells[i])) return i;
  }
  for (let i = 0; i < normalizedCells.length; i++) {
    const cell = normalizedCells[i];
    if (cell && cell.length >= 3 && aliases.some(alias => cell.includes(alias))) {
      return i;
    }
  }
  return -1;
}

// Ищет строку заголовков среди первых MAX_HEADER_SCAN_ROWS строк листа.
// Возвращает { rowIndex, columns } либо null, если обязательные поля
// (дата, статья, сумма) не найдены — тогда вызывающий код обязан
// сообщить об ошибке, а не придумывать разметку.
export function detectHeaderRow(sheetRows) {
  const limit = Math.min(sheetRows.length, MAX_HEADER_SCAN_ROWS);
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = sheetRows[rowIndex];
    const normalizedCells = row.cells.map(
      cell => normalizeHeaderText(cellText(cell))
    );

    const columns = {};
    let hasAllRequired = true;
    for (const field of REQUIRED_FIELDS) {
      const idx = matchField(normalizedCells, HEADER_ALIASES[field]);
      if (idx === -1) {
        hasAllRequired = false;
        break;
      }
      columns[field] = idx;
    }
    if (!hasAllRequired) continue;

    for (const field of Object.keys(HEADER_ALIASES)) {
      if (field in columns) continue;
      const idx = matchField(normalizedCells, HEADER_ALIASES[field]);
      if (idx !== -1) columns[field] = idx;
    }

    return { rowIndex, columns };
  }
  return null;
}

function excelSerialToIsoDate(serial) {
  // Excel (1900-система дат) хранит дату как количество дней от
  // 1899-12-30. 25569 — число дней между этой датой и 1970-01-01.
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeReportDate(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const dotted = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    return excelSerialToIsoDate(serial);
  }
  return null;
}

// Переводит текстовую/числовую сумму отчёта в целые копейки.
// Возвращает null, если формат суммы не распознан (например, формула
// или текст) — такие строки не допускаются до классификации молча.
export function parseAmountToKopecks(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/[\u00A0\s]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const kopecks = Math.round(value * 100);
  if (Math.abs(kopecks - value * 100) > 0.01) return null;
  return kopecks;
}

function normalizeOptionalText(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

// Извлекает операции из строк листа. Строка "Итого"/итоговая не
// попадает в операции, а сохраняется как declaredTotalKopecks для
// контрольной сверки с вычисленной суммой.
export function extractAccrualOperations(sheetRows) {
  const header = detectHeaderRow(sheetRows);
  if (!header) {
    throw new ReportFormatError("ozon_report_header_not_found");
  }

  const operations = [];
  const duplicates = [];
  const seen = new Map();
  let declaredTotalKopecks = null;
  let skippedBlankRows = 0;

  for (let i = header.rowIndex + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const get = field => {
      const idx = header.columns[field];
      if (idx === undefined) return null;
      return cellText(row.cells[idx]);
    };

    const dateRaw = get("date");
    const serviceRaw = get("serviceName");
    const amountRaw = get("amount");

    if (dateRaw === null && serviceRaw === null && amountRaw === null) {
      skippedBlankRows++;
      continue;
    }

    const normalizedService = typeof serviceRaw === "string"
      ? serviceRaw.trim().toLowerCase()
      : "";
    const normalizedDate = typeof dateRaw === "string"
      ? dateRaw.trim().toLowerCase()
      : "";

    if (normalizedService.includes("итого") || normalizedDate.includes("итого")) {
      const amountKopecks = parseAmountToKopecks(amountRaw);
      if (declaredTotalKopecks === null && amountKopecks !== null) {
        declaredTotalKopecks = amountKopecks;
      }
      continue;
    }

    const operationDate = normalizeReportDate(dateRaw);
    const amountKopecks = parseAmountToKopecks(amountRaw);

    if (
      !operationDate ||
      amountKopecks === null ||
      typeof serviceRaw !== "string" ||
      serviceRaw.trim().length === 0
    ) {
      throw new ReportFormatError("ozon_report_row_invalid", {
        rowNumber: row.rowNumber
      });
    }

    const operation = {
      rowNumber: row.rowNumber,
      operationDate,
      serviceName: serviceRaw.trim(),
      serviceGroup: normalizeOptionalText(get("serviceGroup")),
      amountKopecks,
      postingNumber: normalizeOptionalText(get("postingNumber")),
      sku: normalizeOptionalText(get("sku")),
      operationId: normalizeOptionalText(get("operationId"))
    };

    const dedupeKey = [
      operation.operationDate,
      operation.operationId || "",
      operation.postingNumber || "",
      operation.serviceName,
      operation.amountKopecks
    ].join("|");

    if (seen.has(dedupeKey)) {
      duplicates.push({
        rowNumber: operation.rowNumber,
        duplicateOfRow: seen.get(dedupeKey)
      });
    } else {
      seen.set(dedupeKey, operation.rowNumber);
    }

    operations.push(operation);
  }

  return {
    operations,
    duplicates,
    declaredTotalKopecks,
    skippedBlankRows,
    headerRowNumber: sheetRows[header.rowIndex].rowNumber,
    recognizedColumns: Object.keys(header.columns)
  };
}
