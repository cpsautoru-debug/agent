
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

  try {
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

    const result = await env.OZON_FINANCE_DB.prepare(`
      SELECT
        COALESCE(
          NULLIF(TRIM(seller_article), ''),
          'Без артикула'
        ) AS article,
        COUNT(*) AS operations,
        SUM(amount_kopecks) AS amount_kopecks
      FROM ozon_accruals
      WHERE operation_date >= ?
        AND operation_date < ?
      GROUP BY
        COALESCE(
          NULLIF(TRIM(seller_article), ''),
          'Без артикула'
        )
      ORDER BY amount_kopecks DESC, article ASC
    `).bind(
      "2026-10-01",
      "2026-10-30"
    ).all();

    const articles = (result.results || []).map(row => ({
      article: row.article,
      operations: row.operations,
      amountKopecks: row.amount_kopecks
    }));

    return json({
      periodStart: "2026-10-01",
      periodEnd: "2026-10-29",
      currency: "RUB",
      preliminary: true,
      metric: "net_accruals",
      articles,
      totalOperations: articles.reduce(
        (sum, row) => sum + row.operations, 0
      ),
      totalKopecks: articles.reduce(
        (sum, row) => sum + row.amountKopecks, 0
      )
    });
  } catch {
    return json({ error: "Database error" }, 503);
  }
}
