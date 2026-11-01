import { verifySession } from "../auth/session.js";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const TEST_DATE = "2026-10-28";
const TEST_MAX_PAGES = 2;
const MAX_BODY_BYTES = 1024;
const VALID_STATUSES = [
  "not_started",
  "armed",
  "running",
  "complete",
  "partial",
  "failed",
  "skipped"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function checkOwner(request, env) {
  if (
    !env.OFFICE_SESSION_SECRET ||
    !env.OFFICE_ALLOWED_EMAIL ||
    !env.OZON_FINANCE_DB
  ) {
    return { status: 503, error: "Service unavailable" };
  }

  const googleSub = await verifySession(
    request,
    env.OFFICE_SESSION_SECRET
  );
  if (!googleSub) {
    return { status: 401, error: "Unauthorized" };
  }

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

function getService(env) {
  const service = env.OZON_FINANCE_SYNC;
  if (
    !service ||
    typeof service.startOneShotSync !== "function" ||
    typeof service.getOneShotSyncResult !== "function"
  ) {
    return null;
  }
  return service;
}

function safeErrorCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{1,60}$/.test(value)
    ? value
    : null;
}

function safeStartResult(value) {
  const statuses = ["complete", "partial", "failed", "skipped"];
  if (
    !value ||
    !statuses.includes(value.status) ||
    value.date !== TEST_DATE ||
    value.maxPages !== TEST_MAX_PAGES ||
    !Number.isSafeInteger(value.pageCount) ||
    value.pageCount < 0 ||
    value.pageCount > TEST_MAX_PAGES ||
    !Number.isSafeInteger(value.recordCount) ||
    value.recordCount < 0 ||
    !Number.isSafeInteger(value.retryCount) ||
    value.retryCount < 0
  ) {
    return null;
  }
  return {
    status: value.status,
    date: TEST_DATE,
    maxPages: TEST_MAX_PAGES,
    pageCount: value.pageCount,
    recordCount: value.recordCount,
    retryCount: value.retryCount,
    typesSynced: value.typesSynced === true,
    errorCode: safeErrorCode(value.errorCode)
  };
}

function safeRun(value) {
  if (!value) return null;
  if (
    !["running", "complete", "partial", "failed", "skipped"]
      .includes(value.status) ||
    !Number.isSafeInteger(value.pageCount) ||
    !Number.isSafeInteger(value.recordCount) ||
    !Number.isSafeInteger(value.retryCount)
  ) {
    return null;
  }
  return {
    status: value.status,
    pageCount: value.pageCount,
    recordCount: value.recordCount,
    retryCount: value.retryCount,
    typesSynced: value.typesSynced === true,
    errorCode: safeErrorCode(value.errorCode),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null
  };
}

function safeState(value) {
  if (!value) return null;
  if (
    !["running", "complete", "partial", "failed"].includes(value.status) ||
    !Number.isSafeInteger(value.pageCount) ||
    !Number.isSafeInteger(value.recordCount)
  ) {
    return null;
  }
  return {
    status: value.status,
    pageCount: value.pageCount,
    recordCount: value.recordCount,
    complete: value.complete === true,
    reconciled: value.reconciled === true,
    errorCode: safeErrorCode(value.errorCode),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null
  };
}

function safeResult(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.date !== TEST_DATE ||
    value.maxPages !== TEST_MAX_PAGES ||
    !["disarmed", "armed", "claimed"].includes(value.gateStatus) ||
    !VALID_STATUSES.includes(value.status) ||
    !value.accruals ||
    !Number.isSafeInteger(value.accruals.count) ||
    value.accruals.count < 0 ||
    !Number.isSafeInteger(value.accruals.uniqueCount) ||
    value.accruals.uniqueCount < 0 ||
    !Number.isSafeInteger(value.accruals.duplicateCount) ||
    value.accruals.duplicateCount < 0 ||
    value.accruals.uniqueCount > value.accruals.count ||
    value.accruals.duplicateCount !==
      value.accruals.count - value.accruals.uniqueCount ||
    !Number.isSafeInteger(value.accruals.totalKopecks)
  ) {
    return null;
  }

  return {
    date: TEST_DATE,
    maxPages: TEST_MAX_PAGES,
    gateStatus: value.gateStatus,
    claimed: value.claimed === true,
    status: value.status,
    run: safeRun(value.run),
    state: safeState(value.state),
    accruals: {
      count: value.accruals.count,
      uniqueCount: value.accruals.uniqueCount,
      duplicateCount: value.accruals.duplicateCount,
      totalKopecks: value.accruals.totalKopecks
    },
    currency: "RUB",
    reconciled: false
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await checkOwner(request, env);
    if (access) return json({ error: access.error }, access.status);

    const service = getService(env);
    if (!service) return json({ error: "Service unavailable" }, 503);

    const result = safeResult(await service.getOneShotSyncResult());
    if (!result) return json({ error: "Invalid sync status" }, 502);
    return json(result);
  } catch {
    return json({ error: "Sync status unavailable" }, 503);
  }
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

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON required" }, 415);
    }

    const declaredLength = Number(request.headers.get("Content-Length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_BODY_BYTES
    ) {
      return json({ error: "Payload too large" }, 413);
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json({ error: "Payload too large" }, 413);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    ) {
      return json({ error: "Empty JSON object required" }, 400);
    }

    const service = getService(env);
    if (!service) return json({ error: "Service unavailable" }, 503);

    const result = await service.startOneShotSync();
    if (result?.status === "rejected") {
      return json({
        status: "not_started",
        errorCode: "one_shot_gate_not_armed_or_already_claimed"
      }, 409);
    }
    if (result?.status === "unavailable") {
      return json({
        status: "unavailable",
        errorCode: result.errorCode ===
            "controlled_test_configuration_required"
          ? result.errorCode
          : "sync_service_unavailable"
      }, 503);
    }

    const outcome = safeStartResult(result);
    if (!outcome) {
      return json({ error: "Invalid sync service response" }, 502);
    }
    if (outcome.status === "skipped") {
      return json(outcome, 409);
    }
    if (outcome.status === "failed") {
      return json(outcome, 502);
    }
    return json(outcome);
  } catch {
    return json({ error: "Sync start unavailable" }, 503);
  }
}
