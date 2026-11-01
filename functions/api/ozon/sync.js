import { verifySession } from "../auth/session.js";

const MAX_BODY_BYTES = 1024;
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

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

    const service = env.OZON_FINANCE_SYNC;
    if (!service || typeof service.startRecentSync !== "function") {
      return json({ error: "Finance service unavailable" }, 503);
    }

    const result = await service.startRecentSync();
    if (
      result?.status === "rejected" &&
      result.errorCode === "sync_already_running"
    ) {
      return json({
        status: "rejected",
        errorCode: "sync_already_running"
      }, 409);
    }

    if (
      !result ||
      result.status !== "started" ||
      typeof result.runId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(result.runId) ||
      typeof result.periodStart !== "string" ||
      typeof result.periodEnd !== "string"
    ) {
      return json({
        status: "unavailable",
        errorCode: result?.errorCode === "background_sync_unavailable"
          ? "background_sync_unavailable"
          : "sync_service_unavailable"
      }, 503);
    }

    return json({
      status: result.status,
      runId: result.runId,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd
    }, 202);
  } catch {
    return json({ error: "Finance sync could not be started" }, 503);
  }
}
