// Вспомогательный загрузчик ESM-модулей для тестов.
//
// В этом репозитории путь к рабочей копии может содержать не-ASCII
// символы и пробелы (например, каталог "Документы"), из-за чего
// прямой `import()` файлового URL ненадёжен в некоторых средах.
// Существующие тесты (functions/api/ozon/*.test.mjs) решают это,
// инлайнингом исходного кода как `data:text/javascript;base64,...`.
// Этот модуль делает то же самое автоматически и рекурсивно — для
// модулей, которые импортируют друг друга по относительным путям.
import { readFile } from "node:fs/promises";

const IMPORT_STATEMENT = /import\s+(\{[^}]*\})\s+from\s+["']([^"']+)["'];?/g;

const dataUrlCache = new Map();

async function toDataUrl(fileUrl) {
  const key = fileUrl.href;
  if (dataUrlCache.has(key)) return dataUrlCache.get(key);

  let source = await readFile(fileUrl, "utf8");
  const matches = [...source.matchAll(IMPORT_STATEMENT)];

  for (const match of matches) {
    const [statement, bindings, specifier] = match;
    if (!specifier.startsWith(".")) continue;
    const depUrl = new URL(specifier, fileUrl);
    const depDataUrl = await toDataUrl(depUrl);
    source = source.replace(
      statement,
      `const ${bindings} = await import("${depDataUrl}");`
    );
  }

  const dataUrl = `data:text/javascript;base64,${Buffer
    .from(source)
    .toString("base64")}`;
  dataUrlCache.set(key, dataUrl);
  return dataUrl;
}

// `baseUrl` должен быть `import.meta.url` вызывающего тестового файла,
// `specifier` — относительный путь к модулю от этого файла.
export async function importModule(baseUrl, specifier) {
  const fileUrl = new URL(specifier, baseUrl);
  const dataUrl = await toDataUrl(fileUrl);
  return import(dataUrl);
}
