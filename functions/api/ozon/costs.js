
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

    if (access) {
      return json({ error: access.error }, access.status);
    }

    const origin = request.headers.get("Origin");

    if (origin !== new URL(request.url).origin) {
      return json({ error: "Invalid origin" }, 403);
    }

    const contentType =
      request.headers.get("Content-Type") || "";

    if (
      !contentType.toLowerCase()
        .startsWith("application/json")
    ) {
      return json({ error: "JSON required" }, 415);
    }

    const declaredLength = Number(
      request.headers.get("Content-Length")
    );

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_BYTES
    ) {
      return json({ error: "Payload too large" }, 413);
    }

    const raw = await request.text();

    if (
      new TextEncoder().encode(raw).length > MAX_BYTES
    ) {
      return json({ error: "Payload too large" }, 413);
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return json({ error: "Invalid data" }, 400);
    }

    // Старый формат: один товар.
    // Новый формат: { items: [товар1, товар2, ...] }.
    const bulk = Object.prototype.hasOwnProperty.call(
      data,
      "items"
    );

    const incoming = bulk ? data.items : [data];

    if (
      !Array.isArray(incoming) ||
      incoming.length === 0 ||
      incoming.length > MAX_ITEMS
    ) {
      return json({
        error: "Invalid batch size",
        maximum: MAX_ITEMS
      }, 400);
    }

    const items = [];
    const uniqueSkus = new Set();

    // Весь пакет проверяем до любых изменений базы.
    for (let i = 0; i < incoming.length; i++) {
      const item = validateItem(incoming[i]);

      if (!item) {
        return json({
          error: "Invalid fields",
          itemIndex: i
        }, 400);
      }

      if (uniqueSkus.has(item.sku)) {
        return json({
          error: "Duplicate SKU in batch",
          sku: item.sku
        }, 400);
      }

      uniqueSkus.add(item.sku);
      items.push(item);
    }

    const db = env.OZON_FINANCE_DB;

    // Не перезаписываем подтверждённую стоимость
    // предварительной оценкой.
    const placeholders = items.map(() => "?").join(",");

    const existing = await db.prepare(`
      SELECT sku, status
      FROM ozon_cost_entries
      WHERE sku IN (${placeholders})
    `).bind(...items.map(item => item.sku)).all();

    const statuses = new Map(
      (existing.results || []).map(row => [
        row.sku,
        row.status
      ])
    );

    const protectedSkus = items
      .filter(item =>
        statuses.get(item.sku) === "confirmed" &&
        item.status === "preliminary"
      )
      .map(item => item.sku);

    if (protectedSkus.length > 0) {
      return json({
        error: "Confirmed costs are protected",
        protectedSkus
      }, 409);
    }

    const statement = db.prepare(`
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
        cost_kopecks =
          CASE
            WHEN ozon_cost_entries.status = 'confirmed'
             AND excluded.status = 'preliminary'
            THEN NULL
            ELSE excluded.cost_kopecks
          END,
        status = excluded.status,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `);

    const statements = items.map(item =>
      statement.bind(
        item.sku,
        item.sellerArticle,
        item.model,
        item.costKopecks,
        item.status,
        item.source
      )
    );

    // D1 batch выполняет запросы транзакционно.
    // Дополнительная защита в SQL предотвращает
    // перезапись confirmed -> preliminary даже
    // при конкурентном изменении записи.
    try {
      await db.batch(statements);
    } catch {
      return json({
        error: "Batch not saved",
        message:
          "No changes committed. Check protected costs."
      }, 409);
    }

    if (!bulk) {
      return json({
        status: "saved",
        sku: items[0].sku,
        costKopecks: items[0].costKopecks,
        costStatus: items[0].status
      });
    }

    return json({
      status: "batch_saved",
      saved: items.length,
      skus: items.map(item => item.sku)
    });
  } catch {
    return json({ error: "Database error" }, 503);
  }
}
