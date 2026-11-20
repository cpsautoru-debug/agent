import { verifySession } from "../auth/session.js";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.OFFICE_SESSION_SECRET ||
        !env.OFFICE_ALLOWED_EMAIL ||
        !env.OZON_FINANCE_DB) {
      return json(503, { error: "service_unavailable" });
    }

    const sub = await verifySession(request, env.OFFICE_SESSION_SECRET);
    if (!sub) return json(401, { error: "unauthorized" });

    const owner = await env.OZON_FINANCE_DB.prepare(
      "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
    ).bind(sub, env.OFFICE_ALLOWED_EMAIL).first();

    if (owner?.allowed !== 1) {
      return json(403, { error: "forbidden" });
    }

    return json(200, {
      service: "wb_finance",
      officeIntegration: "not_connected",
      dataVerified: false,
      reportAvailable: false,
      readOnly: true
    });
  } catch {
    return json(503, { error: "service_unavailable" });
  }
}
