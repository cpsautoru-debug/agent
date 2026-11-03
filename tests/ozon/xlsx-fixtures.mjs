// Построитель синтетических .xlsx-файлов для тестов. Использует
// только Node Buffer — не зависит от разбираемого парсера, чтобы
// тест оставался независимой проверкой (round-trip), а не тавтологией.
// Записи архива сохраняются методом STORE (без сжатия), поддержка
// DEFLATE в самом парсере проверяется отдельным тестом.
import { Buffer } from "node:buffer";

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (~crc) >>> 0;
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const data = file.data;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, nameBuf, data]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function columnIndexToLetter(index) {
  let letters = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// rows: Array<Array<string | number | null>>
export function buildXlsxBuffer({ sheetName = "Отчет по начислениям", rows }) {
  const sharedStrings = [];
  const stringIndex = new Map();
  function indexFor(text) {
    if (stringIndex.has(text)) return stringIndex.get(text);
    const idx = sharedStrings.length;
    sharedStrings.push(text);
    stringIndex.set(text, idx);
    return idx;
  }

  const rowsXml = rows.map((rowValues, rowIdx) => {
    const rowNumber = rowIdx + 1;
    const cellsXml = rowValues.map((value, colIdx) => {
      if (value === null || value === undefined || value === "") return "";
      const ref = `${columnIndexToLetter(colIdx)}${rowNumber}`;
      if (typeof value === "number") {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      const idx = indexFor(String(value));
      return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cellsXml}</row>`;
  }).join("");

  const sheetXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
    `<sheetData>${rowsXml}</sheetData></worksheet>`;

  const sharedStringsXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings
      .map(text => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
      .join("") +
    "</sst>";

  const workbookXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" " +
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRelsXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
    "<Relationship Id=\"rId1\" " +
    "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" " +
    "Target=\"worksheets/sheet1.xml\"/></Relationships>";

  const contentTypesXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
    "<Default Extension=\"rels\" " +
    "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
    "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
    "<Override PartName=\"/xl/workbook.xml\" " +
    "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
    "<Override PartName=\"/xl/worksheets/sheet1.xml\" " +
    "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
    "<Override PartName=\"/xl/sharedStrings.xml\" " +
    "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/>" +
    "</Types>";

  const rootRelsXml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
    "<Relationship Id=\"rId1\" " +
    "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" " +
    "Target=\"xl/workbook.xml\"/></Relationships>";

  const files = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(workbookRelsXml, "utf8")
    },
    {
      name: "xl/sharedStrings.xml",
      data: Buffer.from(sharedStringsXml, "utf8")
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") }
  ];

  return buildZip(files);
}
