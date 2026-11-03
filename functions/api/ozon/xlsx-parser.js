// Минимальный безопасный разбор .xlsx (ZIP + OOXML) без внешних
// npm-зависимостей. Работает и в Cloudflare Workers/Pages Functions,
// и в Node.js (18+), так как использует только Web-стандартные API:
// DataView, TextDecoder, DecompressionStream("deflate-raw").
//
// Разбираются только структуры, необходимые для официального отчёта
// Ozon "Отчет по начислениям": список листов, общие строки
// (sharedStrings.xml) и ячейки листа. Стили и форматирование не
// учитываются.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_LENGTH = 65535;
const MAX_ZIP_ENTRIES = 2000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

export class XlsxParseError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "XlsxParseError";
    this.code = code;
    this.details = details;
  }
}

function asBytes(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function decodeUtf8(bytes) {
  if (!bytes) return null;
  let view = bytes;
  // Пропускаем UTF-8 BOM, если он присутствует.
  if (
    view.length >= 3 &&
    view[0] === 0xef &&
    view[1] === 0xbb &&
    view[2] === 0xbf
  ) {
    view = view.subarray(3);
  }
  return new TextDecoder("utf-8").decode(view);
}

function findEndOfCentralDirectory(view, bytes) {
  const minPos = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT_LENGTH);
  for (let pos = bytes.length - EOCD_MIN_SIZE; pos >= minPos; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) return pos;
  }
  throw new XlsxParseError("xlsx_zip_eocd_not_found");
}

async function inflateRawRaw(compressed) {
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

// Разбирает ZIP-контейнер и возвращает Map<имяФайла, Uint8Array>
// с уже распакованным содержимым каждой записи.
export async function readZipEntries(input) {
  const bytes = asBytes(input);
  if (bytes.length < EOCD_MIN_SIZE) {
    throw new XlsxParseError("xlsx_zip_too_small");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdPos = findEndOfCentralDirectory(view, bytes);
  const totalEntries = view.getUint16(eocdPos + 10, true);
  const centralDirOffset = view.getUint32(eocdPos + 16, true);

  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new XlsxParseError("xlsx_zip_too_many_entries");
  }

  const centralRecords = [];
  let pos = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new XlsxParseError("xlsx_zip_central_directory_corrupt");
    }
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = decodeUtf8(bytes.subarray(pos + 46, pos + 46 + nameLen));

    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new XlsxParseError("xlsx_zip_entry_too_large");
    }

    centralRecords.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  const entries = new Map();
  for (const record of centralRecords) {
    const localPos = record.localHeaderOffset;
    if (
      localPos + 30 > bytes.length ||
      view.getUint32(localPos, true) !== LOCAL_FILE_SIGNATURE
    ) {
      throw new XlsxParseError("xlsx_zip_local_header_corrupt");
    }
    const nameLen = view.getUint16(localPos + 26, true);
    const extraLen = view.getUint16(localPos + 28, true);
    const dataStart = localPos + 30 + nameLen + extraLen;
    const compressed = bytes.subarray(
      dataStart,
      dataStart + record.compressedSize
    );

    let data;
    if (record.method === 0) {
      data = compressed;
    } else if (record.method === 8) {
      data = await inflateRawRaw(compressed);
    } else {
      throw new XlsxParseError("xlsx_zip_unsupported_compression", {
        method: record.method
      });
    }

    if (data.length !== record.uncompressedSize) {
      throw new XlsxParseError("xlsx_zip_entry_size_mismatch", {
        name: record.name
      });
    }

    entries.set(record.name, data);
  }

  return entries;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

// Разбирает xl/sharedStrings.xml в массив строк (по индексу <si>).
export function parseSharedStrings(xmlText) {
  const items = xmlText.match(/<si[\s>][\s\S]*?<\/si>|<si\s*\/>/g) || [];
  return items.map(item => {
    const textRuns = [...item.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    return textRuns.map(match => decodeXmlEntities(match[1])).join("");
  });
}

function columnLetterToIndex(letters) {
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col - 1;
}

// Разбирает лист (xl/worksheets/sheetN.xml) в массив строк вида
// { rowNumber, cells: [{ type, value } | undefined, ...] }.
// Числовые ("n") значения возвращаются как исходная строка —
// интерпретацию (число/дата) выполняет вызывающий код.
export function parseSheetRows(xmlText, sharedStrings) {
  const rowBlocks = xmlText.match(
    /<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g
  ) || [];
  const rows = [];

  for (const rowXml of rowBlocks) {
    const rowNumberMatch = rowXml.match(/\br="(\d+)"/);
    const rowNumber = rowNumberMatch
      ? Number(rowNumberMatch[1])
      : rows.length + 1;

    const cells = [];
    const cellBlocks = rowXml.match(
      /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g
    ) || [];

    for (const cellXml of cellBlocks) {
      const refMatch = cellXml.match(/\br="([A-Z]+)\d+"/);
      const typeMatch = cellXml.match(/\bt="([a-zA-Z]+)"/);
      const type = typeMatch ? typeMatch[1] : "n";
      const colIndex = refMatch
        ? columnLetterToIndex(refMatch[1])
        : cells.length;

      let value = null;
      if (type === "s") {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        const idx = vMatch ? Number(vMatch[1]) : null;
        value = idx !== null && Number.isInteger(idx)
          ? sharedStrings[idx] ?? null
          : null;
      } else if (type === "inlineStr") {
        const tMatch = cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
        value = tMatch ? decodeXmlEntities(tMatch[1]) : null;
      } else if (type === "str" || type === "e" || type === "b") {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        value = vMatch ? decodeXmlEntities(vMatch[1]) : null;
      } else {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        value = vMatch ? vMatch[1] : null;
      }

      cells[colIndex] = { type, value };
    }

    rows.push({ rowNumber, cells });
  }

  return rows;
}

function parseRelationships(relsXml) {
  const map = new Map();
  if (!relsXml) return map;
  const blocks = relsXml.match(/<Relationship\b[^>]*\/>/g) || [];
  for (const block of blocks) {
    const id = (block.match(/\bId="([^"]*)"/) || [])[1];
    const target = (block.match(/\bTarget="([^"]*)"/) || [])[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

function resolveSheetPath(target) {
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target.replace(/^\.?\/*/, "")}`;
}

// Высокоуровневая функция: байты .xlsx -> { sheets: [{ name, rows }] }.
export async function parseWorkbookXlsx(input) {
  const bytes = asBytes(input);
  const entries = await readZipEntries(bytes);

  const workbookXml = decodeUtf8(entries.get("xl/workbook.xml"));
  if (!workbookXml) throw new XlsxParseError("xlsx_workbook_missing");

  const relsXml = decodeUtf8(entries.get("xl/_rels/workbook.xml.rels"));
  const relMap = parseRelationships(relsXml);

  const sheetDefs = (workbookXml.match(/<sheet\b[^>]*\/>/g) || []).map(tag => {
    const name = (tag.match(/\bname="([^"]*)"/) || [])[1];
    const rId = (tag.match(/r:id="([^"]*)"/) || [])[1];
    return { name: name ? decodeXmlEntities(name) : null, rId };
  });

  if (sheetDefs.length === 0) {
    throw new XlsxParseError("xlsx_no_sheet_definitions");
  }

  const sharedStringsXml = decodeUtf8(entries.get("xl/sharedStrings.xml"));
  const sharedStrings = sharedStringsXml
    ? parseSharedStrings(sharedStringsXml)
    : [];

  const sheets = [];
  for (const def of sheetDefs) {
    const target = def.rId ? relMap.get(def.rId) : null;
    if (!target) continue;
    const path = resolveSheetPath(target);
    const sheetXml = decodeUtf8(entries.get(path));
    if (!sheetXml) continue;
    sheets.push({
      name: def.name,
      rows: parseSheetRows(sheetXml, sharedStrings)
    });
  }

  if (sheets.length === 0) throw new XlsxParseError("xlsx_no_sheets_found");
  return { sheets };
}
