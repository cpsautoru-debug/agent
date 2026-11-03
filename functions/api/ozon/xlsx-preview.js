// Pages Function: POST /api/ozon/xlsx-preview
//
// Безопасный Preview-импорт официального отчёта Ozon по начислениям.
// Только владелец (Google-сессия + роль owner в тестовой D1).
// НИКАКИХ записей в базу: функция вызывает buildXlsxImportPreview,
// которая гарантированно не выполняет INSERT/UPDATE/DELETE.
import { verifySession } from "../auth/session.js";
import {
  buildXlsxImportPreview,
  MAX_REPORT_BYTES,
  XlsxImportError
} from "./xlsx-import-preview.js";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

// Повторяет проверку владельца из reconciliation.js, но сознательно
// не импортируется оттуда, чтобы не трогать существующий финансовый
// модуль (reconciliation-core.js/reconciliation.js) без доказанной
// необходимости.
async function checkOwner(request, env) {
  if (
    !env.OFFICE_SESSION_SECRET ||
    !env.OFFICE_ALLOWED_EMAIL ||
    !env.OZON_FINANCE_DB
  ) {
    return { status: 503, error: "Service unavailable" };
  }

  const googleSub = await verifySession(request, env.OFFICE_SESSION_SECRET);
  if (!googleSub) return { status: 401, error: "Unauthorized" };

  const owner = await env.OZON_FINANCE_DB.prepare(`
    SELECT 1 AS allowed
    FROM office_authorized_users
    WHERE google_sub = ?
      AND email = ?
      AND role = 'owner'
    LIMIT 1
  `).bind(googleSub, env.OFFICE_ALLOWED_EMAIL).first();

  return owner ? null : { status: 403, error: "Forbidden" };
}

function errorStatus(code) {
  if (
    code === "xlsx_invalid_payload" ||
    code === "xlsx_empty_file" ||
    code === "xlsx_file_too_large" ||
    code === "xlsx_invalid_file_name" ||
    code === "xlsx_invalid_file_signature" ||
    code === "xlsx_parse_failed" ||
    code === "xlsx_report_format_invalid"
  ) {
    return 400;
  }
  return 502;
}

export async function onRequestPost({ request, env }) {
  try {
    const access = await checkOwner(request, env);
    if (access) return json({ error: access.error }, access.status);

    if (
      request.headers.get("Origin") !== new URL(request.url).origin ||
      (
        request.headers.has("Sec-Fetch-Site") &&
        request.headers.get("Sec-Fetch-Site") !== "same-origin"
      )
    ) {
      return json({ error: "Invalid origin" }, 403);
    }

    const declaredLength = Number(request.headers.get("Content-Length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_REPORT_BYTES + 65536
    ) {
      return json({ error: "Payload too large" }, 413);
    }

    const contentType = (request.headers.get("Content-Type") || "")
      .toLowerCase();
    if (!contentType.startsWith("multipart/form-data")) {
      return json({ error: "multipart/form-data required" }, 415);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: "Invalid form data" }, 400);
    }

    const file = formData.get("report");
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ error: "Missing report file" }, 400);
    }
    if (typeof file.size === "number" && file.size > MAX_REPORT_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (fileBytes.byteLength > MAX_REPORT_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    const preview = await buildXlsxImportPreview({
      fileBytes,
      fileName: typeof file.name === "string" ? file.name : "report.xlsx",
      // ВАЖНО: env.OZON_FINANCE_DB в Pages-проекте — это D1 офиса
      // (office_authorized_users, только для проверки роли owner
      // выше). В ней НЕТ таблицы ozon_api_accruals и она НЕ связана с
      // тестовой финансовой D1 autosklad63-ozon-finance-sync-test.
      // Для сверки с реальными начислениями API используется ТОЛЬКО
      // Service Binding OZON_FINANCE_SYNC на тестовый Worker
      // (autosklad63-ozon-sync-worker-test), который сам читает
      // тестовую D1 и отдаёт read-only агрегаты по датам.
      financeSyncService: env.OZON_FINANCE_SYNC
    });

    return json(preview);
  } catch (error) {
    if (error instanceof XlsxImportError) {
      return json(
        { error: "Invalid report", errorCode: error.code },
        errorStatus(error.code)
      );
    }
    return json({ error: "Preview unavailable" }, 503);
  }
}
