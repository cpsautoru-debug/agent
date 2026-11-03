import { verifySession } from "../auth/session.js";

const JOB_ID = "ozon-oct-2026-manual-1";
const MAX_BODY_BYTES = 1024;

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}

export async function onRequestGet() {
  return json({ error: "Method not allowed" }, 405);
}

export async function onRequestPost({ request, env }) {
  try {
    if (
      !env.OFFICE_SESSION_SECRET ||
      !env.OFFICE_ALLOWED_EMAIL ||
      !env.OZON_FINANCE_DB
    ) {
      return json({ error: "Service unavailable" }, 503);
    }

    const googleSub = await verifySession(
      request,
      env.OFFICE_SESSION_SECRET
    );

    if (!googleSub) {
      return json({ error: "Unauthorized" }, 401);
    }

    const owner = await env.OZON_FINANCE_DB.prepare(`
      SELECT 1 AS allowed
      FROM office_authorized_users
      WHERE google_sub = ?
        AND email = ?
        AND role = 'owner'
      LIMIT 1
    `).bind(
      googleSub,
      env.OFFICE_ALLOWED_EMAIL
    ).first();

    if (!owner) {
      return json({ error: "Forbidden" }, 403);
    }

    const origin = new URL(request.url).origin;

    if (
      request.headers.get("Origin") !== origin ||
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

    const declaredLength = Number(
      request.headers.get("Content-Length")
    );

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
      Object.keys(body).length !== 1 ||
      !["prepare", "run"].includes(body.action)
    ) {
      return json({ error: "Invalid action" }, 400);
    }

    const service = env.OZON_FINANCE_SYNC;

    if (
      !service ||
      typeof service.prepareOctoberBackfill !== "function" ||
      typeof service.runBackfillBatch !== "function"
    ) {
      return json({ error: "Worker unavailable" }, 503);
    }

    const result = body.action === "prepare"
      ? await service.prepareOctoberBackfill(JOB_ID, 1)
      : await service.runBackfillBatch(JOB_ID);

    const validStatuses = new Set([
      "prepared", "running", "paused", "complete",
      "failed", "skipped", "rejected", "unavailable"
    ]);

    if (!result || !validStatuses.has(result.status)) {
      return json({ error: "Invalid Worker response" }, 502);
    }

    const publicResult = {
      status: result.status,
      jobId: JOB_ID,
      nextDate: typeof result.nextDate === "string"
        ? result.nextDate
        : null,
      completedDates: Number.isSafeInteger(result.completedDates)
        ? result.completedDates
        : null,
      recordCount: Number.isSafeInteger(result.recordCount)
        ? result.recordCount
        : null,
      errorCode:
        typeof result.errorCode === "string" &&
        /^[a-z0-9_]{1,60}$/.test(result.errorCode)
          ? result.errorCode
          : null
    };

    const httpStatus = result.status === "rejected"
      ? 409
      : result.status === "unavailable"
        ? 503
        : result.status === "failed"
          ? 502
          : 200;

    return json(publicResult, httpStatus);

  } catch {
    return json({ error: "Backfill unavailable" }, 503);
  }
}
