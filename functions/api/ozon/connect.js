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
    return json({
      connected: false,
      status: "unavailable"
    }, 503);
  }

  let googleSub;
  let owner;

  try {
    googleSub = await verifySession(
      request,
      env.OFFICE_SESSION_SECRET
    );

    if (!googleSub) {
      return json({
        connected: false,
        status: "unauthorized"
      }, 401);
    }

    owner = await env.OZON_FINANCE_DB.prepare(`
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
  } catch {
    return json({
      connected: false,
      status: "unavailable"
    }, 503);
  }

  if (!owner) {
    return json({
      connected: false,
      status: "forbidden"
    }, 403);
  }

  if (!env.OZON_CLIENT_ID || !env.OZON_API_KEY) {
    return json({
      connected: false,
      status: "unavailable"
    }, 503);
  }

  try {
    const response = await fetch(
      "https://api-seller.ozon.ru/v3/product/list",
      {
        method: "POST",
        headers: {
          "Client-Id": env.OZON_CLIENT_ID,
          "Api-Key": env.OZON_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filter: {
            visibility: "ALL"
          },
          last_id: "",
          limit: 1
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      return json({
        connected: false,
        status: "disconnected"
      }, 502);
    }

    const data = await response.json();

    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !Array.isArray(data.items)
    ) {
      return json({
        connected: false,
        status: "disconnected"
      }, 502);
    }

    return json({
      connected: true,
      status: "connected"
    });
  } catch {
    return json({
      connected: false,
      status: "disconnected"
    }, 502);
  }
}
