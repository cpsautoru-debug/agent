// Статическая проверка: в Preview-модулях импорта XLSX не должно быть
// ни одного SQL write-глагола (INSERT/UPDATE/DELETE/REPLACE), а также
// не должно быть вызовов .run()/.batch() на объекте БД — это защита
// от случайного появления записи в Preview-пути при будущих правках.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PREVIEW_FILES = [
  "../../functions/api/ozon/xlsx-import-preview.js",
  "../../functions/api/ozon/xlsx-preview.js"
];

const WRITE_SQL_VERBS = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\b/i;
const WRITE_DB_CALLS = /\.(run|batch|exec)\s*\(/;

for (const relativePath of PREVIEW_FILES) {
  test(`${relativePath} contains no SQL write statements or write-method calls`, async () => {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");

    const sqlMatch = source.match(WRITE_SQL_VERBS);
    assert.equal(
      sqlMatch,
      null,
      sqlMatch ? `Found forbidden SQL verb: ${sqlMatch[0]}` : undefined
    );

    const callMatch = source.match(WRITE_DB_CALLS);
    assert.equal(
      callMatch,
      null,
      callMatch ? `Found forbidden write-method call: ${callMatch[0]}` : undefined
    );
  });
}

test("xlsx-import-preview.js only ever calls .prepare(...).bind(...).first()/.all() on the database handle", async () => {
  const source = await readFile(
    new URL("../../functions/api/ozon/xlsx-import-preview.js", import.meta.url),
    "utf8"
  );
  // Любое использование db.<метод>( за пределами разрешённого списка
  // должно быть явно просмотрено - тест фиксирует текущий белый список.
  const dbMethodCalls = [...source.matchAll(/\bdb\.(\w+)\s*\(/g)].map(m => m[1]);
  const allowed = new Set(["prepare"]);
  for (const method of dbMethodCalls) {
    assert.ok(allowed.has(method), `Unexpected db.${method}() call in preview module`);
  }
});
