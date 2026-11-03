import assert from "node:assert/strict";
import test from "node:test";
import { importModule } from "./load-module.mjs";
import { buildXlsxBuffer } from "./xlsx-fixtures.mjs";

const { onRequestPost } = await importModule(
  import.meta.url,
  "../../functions/api/ozon/xlsx-preview.js"
);

const SHEET_ROWS = [
  ["Дата начисления", "Тип начисления", "Итого, руб.", "Номер отправления", "Артикул"],
  ["31.10.2026", "Реализация товара", 9105.96, "P-1", "SKU-1"],
  ["Итого", null, 9105.96, null, null]
];

async function ownerCookie(sub = "local-owner") {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub,
    iat: now,
    exp: now + 8 * 60 * 60
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("local-session-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  )).toString("base64url");
  return `__Host-office_session=${payload}.${signature}`;
}

// Стаб D1: отвечает ТОЛЬКО на owner-проверку (office_authorized_users).
// Это D1 Pages-проекта и у неё нет и не должно быть таблицы
// ozon_api_accruals — любой запрос к финансовым таблицам через этот
// биндинг указывает на возврат архитектурной ошибки, поэтому стаб
// намеренно бросает исключение на любой другой запрос. Не реализует
// run()/batch() — любая попытка Preview выполнить запись бросит
// исключение и тест завалится, что служит дополнительной гарантией
// "никаких записей в Preview".
function officeAuthDb({ owner = true } = {}) {
  return {
    prepare(sql) {
      const normalized = sql.trim().toUpperCase();
      assert.ok(normalized.startsWith("SELECT"), "Preview must only SELECT");
      if (/office_authorized_users/.test(sql)) {
        return {
          bind: (...values) => ({
            first: async () => {
              assert.deepEqual(values, ["local-owner", "owner@example.test"]);
              return owner ? { allowed: 1 } : null;
            }
          })
        };
      }
      throw new Error(
        "ARCHITECTURE REGRESSION: Pages OZON_FINANCE_DB must never be " +
        "queried for finance accrual data, only for office_authorized_users. " +
        "Unexpected query: " + sql
      );
    }
  };
}

// Мок RPC Service Binding'а (env.OZON_FINANCE_SYNC) на тестовый Worker
// autosklad63-ozon-sync-worker-test — единственный разрешённый канал
// для получения агрегатов начислений API.
function financeSyncServiceStub(dailyByDate = {}) {
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

function environment({ owner = true, financeSyncService } = {}) {
  const env = {
    OFFICE_SESSION_SECRET: "local-session-secret",
    OFFICE_ALLOWED_EMAIL: "owner@example.test",
    OZON_FINANCE_DB: officeAuthDb({ owner })
  };
  if (financeSyncService !== undefined) {
    env.OZON_FINANCE_SYNC = financeSyncService;
  }
  return env;
}

function multipartRequest({
  cookie,
  origin = "https://office.test",
  fetchSite = "same-origin",
  contentType,
  body,
  fileName = "report.xlsx",
  fileBytes
} = {}) {
  const headers = { Origin: origin, "Sec-Fetch-Site": fetchSite };
  if (cookie) headers.Cookie = cookie;

  if (body !== undefined) {
    if (contentType) headers["Content-Type"] = contentType;
    return new Request("https://office.test/api/ozon/xlsx-preview", {
      method: "POST",
      headers,
      body
    });
  }

  const form = new FormData();
  form.append(
    "report",
    new File([fileBytes ?? buildXlsxBuffer({ rows: SHEET_ROWS })], fileName)
  );
  return new Request("https://office.test/api/ozon/xlsx-preview", {
    method: "POST",
    headers,
    body: form
  });
}

test("xlsx-preview requires an authenticated session", async () => {
  const response = await onRequestPost({
    request: multipartRequest({}),
    env: environment()
  });
  assert.equal(response.status, 401);
});

test("xlsx-preview requires the owner role", async () => {
  const cookie = await ownerCookie();
  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    env: environment({ owner: false })
  });
  assert.equal(response.status, 403);
});

test("xlsx-preview rejects non-multipart content types", async () => {
  const cookie = await ownerCookie();
  const response = await onRequestPost({
    request: multipartRequest({
      cookie,
      body: JSON.stringify({}),
      contentType: "application/json"
    }),
    env: environment()
  });
  assert.equal(response.status, 415);
});

test("xlsx-preview rejects an oversized Content-Length before reading the body", async () => {
  const cookie = await ownerCookie();
  const request = multipartRequest({ cookie });
  request.headers.set("Content-Length", String(21 * 1024 * 1024));
  const response = await onRequestPost({ request, env: environment() });
  assert.equal(response.status, 413);
});

test("xlsx-preview returns a preview-only report for a valid owner upload and performs no writes", async () => {
  const cookie = await ownerCookie();
  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    env: environment()
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.status, "preview_only");
  assert.equal(body.writesPerformed, false);
  assert.equal(body.insertStatementsExecuted, 0);
  assert.equal(body.source.detailRows, 1);
});

test("xlsx-preview routes API comparison through the OZON_FINANCE_SYNC service binding, never through the Pages auth D1", async () => {
  const cookie = await ownerCookie();
  const financeSyncService = financeSyncServiceStub({
    "2026-10-31": {
      recordCount: 1, totalKopecks: 910596, syncComplete: true, reconciled: true
    }
  });

  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    env: environment({ financeSyncService })
  });
  assert.equal(response.status, 200);

  // getAccrualDailyTotals вызван ровно один раз — через Service
  // Binding, а не через прямой SQL к env.OZON_FINANCE_DB (стаб
  // officeAuthDb бросил бы исключение при любой попытке прочитать
  // финансовые таблицы напрямую, и тест бы упал).
  assert.equal(financeSyncService.calls.length, 1);
  assert.deepEqual(financeSyncService.calls[0], ["2026-10-31", "2026-10-31"]);

  const body = await response.json();
  assert.ok(body.apiComparison);
  assert.equal(body.reconciliationStatus, "amounts_match_confirmed_sync_complete");
});

test("xlsx-preview gracefully skips API comparison when OZON_FINANCE_SYNC service binding is absent", async () => {
  const cookie = await ownerCookie();
  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    // environment() без financeSyncService не выставляет
    // env.OZON_FINANCE_SYNC вовсе — воспроизводит окружение, где
    // Service Binding не настроен.
    env: environment()
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.status, "preview_only");
  assert.equal(body.apiComparison, null);
  assert.equal(body.reconciliationStatus, "api_comparison_skipped_no_service_binding");
});

test("xlsx-preview reports when the test D1 behind the service binding has no synced record for the date", async () => {
  const cookie = await ownerCookie();
  // Служба отвечает, но для 31.10.2026 данных вообще нет (синхронизация
  // ещё не запускалась) — день не должен считаться сверенным.
  const financeSyncService = financeSyncServiceStub({});

  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    env: environment({ financeSyncService })
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  const oct31 = body.apiComparison.byDate.find(
    entry => entry.operationDate === "2026-10-31"
  );
  assert.equal(oct31.status, "no_api_data_for_date");
  assert.equal(body.reconciliationStatus, "no_api_data_for_some_dates");
});

test("xlsx-preview flags an amount discrepancy between the Excel file and the API totals instead of hiding it", async () => {
  const cookie = await ownerCookie();
  const financeSyncService = financeSyncServiceStub({
    "2026-10-31": {
      recordCount: 1, totalKopecks: 1, syncComplete: true, reconciled: true
    }
  });

  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    env: environment({ financeSyncService })
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  const oct31 = body.apiComparison.byDate.find(
    entry => entry.operationDate === "2026-10-31"
  );
  assert.equal(oct31.status, "amount_mismatch");
  assert.equal(oct31.differenceKopecks, 910596 - 1);
  assert.equal(body.reconciliationStatus, "amount_mismatch_requires_manual_confirmation");
});

test("REGRESSION (owner-confirmed real D1 state): status=complete, page_complete=1, matching sums, reconciled=0 shows 'amounts match, formal reconciliation pending', never an incomplete-load error or a false confirmed-reconciliation status", async () => {
  const cookie = await ownerCookie();
  // Реальное состояние тестовой D1, подтверждённое владельцем для
  // 31.10.2026: status=complete, page_complete=1, record_count=30,
  // reconciled=0. Файл в этом тесте содержит одну строку на 9105.96 ₽
  // за 31.10.2026 — совпадает с API totalKopecks=910596 (owner's value
  // scaled to this synthetic single-row fixture would differ, поэтому
  // используем сумму, реально совпадающую со строкой фикстуры).
  const financeSyncService = financeSyncServiceStub({
    "2026-10-31": {
      recordCount: 30, totalKopecks: 910596, syncComplete: true, reconciled: false
    }
  });

  const response = await onRequestPost({
    request: multipartRequest({ cookie }),
    env: environment({ financeSyncService })
  });
  assert.equal(response.status, 200);

  const body = await response.json();
  const oct31 = body.apiComparison.byDate.find(
    entry => entry.operationDate === "2026-10-31"
  );
  assert.equal(oct31.apiLoadComplete, true);
  assert.equal(oct31.amountsMatch, true);
  assert.equal(oct31.apiReconciled, false);
  assert.equal(oct31.status, "amounts_match_pending_formal_reconciliation");
  assert.notEqual(oct31.status, "api_sync_incomplete");
  assert.notEqual(oct31.status, "amounts_match_reconciled");
  assert.equal(
    body.reconciliationStatus,
    "amounts_match_pending_formal_reconciliation"
  );
});

test("xlsx-preview rejects requests from a foreign Origin", async () => {
  const cookie = await ownerCookie();
  const response = await onRequestPost({
    request: multipartRequest({ cookie, origin: "https://evil.test" }),
    env: environment()
  });
  assert.equal(response.status, 403);
});
