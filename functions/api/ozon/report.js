
import { verifySession } from "../auth/session.js";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

export async function onRequestGet({ request, env }) {
  if (
    !env.OFFICE_SESSION_SECRET ||
    !env.OFFICE_ALLOWED_EMAIL ||
    !env.OZON_FINANCE_DB
  ) {
    return json({ error: "Service unavailable" }, 503);
  }

  const sub = await verifySession(
    request,
    env.OFFICE_SESSION_SECRET
  );

  if (!sub) {
    return json({ error: "Unauthorized" }, 401);
  }

  const owner = await env.OZON_FINANCE_DB.prepare(`
    SELECT 1 AS allowed
    FROM office_authorized_users
    WHERE google_sub = ?
      AND email = ?
      AND role = 'owner'
    LIMIT 1
  `).bind(sub, env.OFFICE_ALLOWED_EMAIL).first();

  if (!owner) {
    return json({ error: "Forbidden" }, 403);
  }

  const report = await env.OZON_FINANCE_DB.prepare(`
    SELECT
      period,
      processed_days,
      records_count,
      posting_kopecks,
      item_kopecks,
      non_item_kopecks,
      control_total_kopecks,
      complete,
      reconciled,
      final
    FROM ozon_finance_reports
    WHERE period = ?
    LIMIT 1
  `).bind("2026-10").first();

  if (!report) {
    return json({ error: "Report not found" }, 404);
  }

  return json({
    period: report.period,
    processedDays: report.processed_days,
    recordsCount: report.records_count,
    postingKopecks: report.posting_kopecks,
    itemKopecks: report.item_kopecks,
    nonItemKopecks: report.non_item_kopecks,
    totalKopecks: report.control_total_kopecks,
    complete: report.complete === 1,
    reconciled: report.reconciled === 1,
    final: report.final === 1
  });
}
