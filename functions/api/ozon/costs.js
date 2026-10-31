
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

async function checkOwner(request, env) {
  if (
    !env.OFFICE_SESSION_SECRET ||
    !env.OFFICE_ALLOWED_EMAIL ||
    !env.OZON_FINANCE_DB
  ) {
    return { error: "Service unavailable", status: 503 };
  }

  const sub = await verifySession(
    request,
    env.OFFICE_SESSION_SECRET
  );

  if (!sub) {
    return { error: "Unauthorized", status: 401 };
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
    return { error: "Forbidden", status: 403 };
  }

  return null;
}

function validText(value, maximum) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await checkOwner(request, env);
    if (access) return json({ error: access.error }, access.status);

    const result = await env.OZON_FINANCE_DB.prepare(`
      SELECT
        sku,
        seller_article,
        model,
        cost_kopecks,
        status,
        source,
        updated_at
      FROM ozon_cost_entries
      ORDER BY model, seller_article, sku
    `).all();

    return json({
      currency: "RUB",
      costs: result.results || []
    });
  } catch {
    return json({ error: "Database error" }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const access = await checkOwner(request, env);
    if (access) return json({ error: access.error }, access.status);

    const origin = request.headers.get("Origin");

    if (origin !== new URL(request.url).origin) {
      return json({ error: "Invalid origin" }, 403);
    }

    if (
      !(request.headers.get("Content-Type") || "")
        .toLowerCase()
        .startsWith("application/json")
    ) {
      return json({ error: "JSON required" }, 415);
    }

    const length = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(length) && length > 4096) {
      return json({ error: "Payload too large" }, 413);
    }

    const raw = await request.text();

    if (new TextEncoder().encode(raw).length > 4096) {
      return json({ error: "Payload too large" }, 413);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!data || typeof data !== "object" ||
        Array.isArray(data)) {
      return json({ error: "Invalid data" }, 400);
    }

    const {
      sku,
      sellerArticle,
      model,
      costKopecks,
      status,
      source
    } = data;

    if (
      !validText(sku, 150) ||
      !validText(sellerArticle, 250) ||
      !validText(model, 100) ||
      !Number.isSafeInteger(costKopecks) ||
      costKopecks <= 0 ||
      costKopecks > 100000000 ||
      !["preliminary", "confirmed"].includes(status) ||
      !validText(source, 250)
    ) {
      return json({ error: "Invalid fields" }, 400);
    }

    await env.OZON_FINANCE_DB.prepare(`
      INSERT INTO ozon_cost_entries (
        sku,
        seller_article,
        model,
        cost_kopecks,
        status,
        source,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(sku) DO UPDATE SET
        seller_article = excluded.seller_article,
        model = excluded.model,
        cost_kopecks = excluded.cost_kopecks,
        status = excluded.status,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      sku.trim(),
      sellerArticle.trim(),
      model.trim(),
      costKopecks,
      status,
      source.trim()
    ).run();

    return json({
      status: "saved",
      sku: sku.trim(),
      costKopecks,
      costStatus: status
    });
  } catch {
    return json({ error: "Database error" }, 503);
  }
}
