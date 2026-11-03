
import { verifySession } from "../auth/session.js";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

const MAX_ITEMS = 50;
const MAX_BYTES = 24000;

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
    SELECT 1
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

function validateItem(item) {
  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item)
  ) {
    return null;
  }

  const {
    sku,
    sellerArticle,
    model,
    costKopecks,
    status,
    source
  } = item;

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
    return null;
  }

  return {
    sku: sku.trim(),
    sellerArticle: sellerArticle.trim(),
    model: model.trim(),
    costKopecks,
    status,
    source: source.trim()
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await checkOwner(request, env);

    if (access) {
      return json({ error: access.error }, access.status);
    }

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
    if (request.headers.get("Origin") !== new URL(request.url).origin) {
      return json({ error: "Invalid origin" }, 403);
    }
    return json({
      error: "Preview and confirm required",
      workflow: "/api/ozon/profit",
      screen: "#ozonProfit"
    }, 409);
  } catch {
    return json({ error: "Service unavailable" }, 503);
  }
}