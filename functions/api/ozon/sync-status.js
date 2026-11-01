import { verifySession } from "../auth/session.js";

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

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await checkOwner(request, env);
    if (access) return json({ error: access.error }, access.status);

    const service = env.OZON_FINANCE_SYNC;
    if (!service ||
        typeof service.getFinanceDashboard !== "function") {
      return json({ error: "Finance service unavailable" }, 503);
    }

    const url = new URL(request.url);
    const start = url.searchParams.get("start") || undefined;
    const end = url.searchParams.get("end") || undefined;
    if (
      (start === undefined) !== (end === undefined) ||
      (start !== undefined && !validDate(start)) ||
      (end !== undefined && !validDate(end))
    ) {
      return json({ error: "Invalid period" }, 400);
    }

    const dashboard = await service.getFinanceDashboard(start, end);
    if (
      !dashboard ||
      dashboard.source !== "ozon_seller_api" ||
      dashboard.currency !== "RUB" ||
      !Array.isArray(dashboard.daily) ||
      !Array.isArray(dashboard.categories) ||
      !Array.isArray(dashboard.operations) ||
      !dashboard.totals ||
      !dashboard.coverage
    ) {
      return json({ error: "Invalid finance response" }, 502);
    }

    return json({
      ...dashboard,
      reconciled: dashboard.daily.length > 0 &&
        dashboard.daily.every(day => day.complete && day.reconciled)
    });
  } catch {
    return json({ error: "Finance sync status unavailable" }, 503);
  }
}
