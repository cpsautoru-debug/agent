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

function diagnostic(
  connected,
  status,
  httpStatus,
  errorCode,
  stage,
  ozonHttpStatus = null
) {
  return json({
    connected,
    status,
    errorCode,
    stage,
    ozonHttpStatus
  }, httpStatus);
}

function isTimeout(error) {
  return error?.name === "TimeoutError" ||
    error?.name === "AbortError";
}

export async function onRequestGet({ request, env }) {
  if (
    !env.OFFICE_SESSION_SECRET ||
    !env.OFFICE_ALLOWED_EMAIL ||
    !env.OZON_FINANCE_DB
  ) {
    return diagnostic(
      false,
      "unavailable",
      503,
      "office_configuration_missing",
      "configuration"
    );
  }

  let googleSub;
  let owner;

  try {
    googleSub = await verifySession(
      request,
      env.OFFICE_SESSION_SECRET
    );

    if (!googleSub) {
      return diagnostic(
        false,
        "unauthorized",
        401,
        "google_session_missing_or_invalid",
        "authorization"
      );
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
    return diagnostic(
      false,
      "unavailable",
      503,
      "owner_authorization_unavailable",
      "authorization"
    );
  }

  if (!owner) {
    return diagnostic(
      false,
      "forbidden",
      403,
      "owner_access_required",
      "authorization"
    );
  }

  if (!env.OZON_CLIENT_ID) {
    return diagnostic(
      false,
      "unavailable",
      503,
      "ozon_client_id_missing",
      "configuration"
    );
  }

  if (!env.OZON_API_KEY) {
    return diagnostic(
      false,
      "unavailable",
      503,
      "ozon_api_key_missing",
      "configuration"
    );
  }

  let response;

  try {
    response = await fetch(
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
  } catch (error) {
    if (isTimeout(error)) {
      return diagnostic(
        false,
        "disconnected",
        504,
        "ozon_request_timeout",
        "ozon_request"
      );
    }

    return diagnostic(
      false,
      "disconnected",
      502,
      "ozon_network_error",
      "ozon_request"
    );
  }

  if (!response.ok) {
    const errorCode = response.status === 401
      ? "ozon_unauthorized"
      : response.status === 403
        ? "ozon_forbidden"
        : "ozon_http_error";

    return diagnostic(
      false,
      "disconnected",
      502,
      errorCode,
      "ozon_http",
      response.status
    );
  }

  let responseBody;

  try {
    responseBody = await response.text();
  } catch (error) {
    if (isTimeout(error)) {
      return diagnostic(
        false,
        "disconnected",
        504,
        "ozon_request_timeout",
        "ozon_response",
        response.status
      );
    }

    return diagnostic(
      false,
      "disconnected",
      502,
      "ozon_network_error",
      "ozon_response",
      response.status
    );
  }

  let data;

  try {
    data = JSON.parse(responseBody);
  } catch {
    return diagnostic(
      false,
      "disconnected",
      502,
      "ozon_invalid_api_response",
      "ozon_response",
      response.status
    );
  }

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !data.result ||
    typeof data.result !== "object" ||
    Array.isArray(data.result) ||
    !Array.isArray(data.result.items)
  ) {
    return diagnostic(
      false,
      "disconnected",
      502,
      "ozon_invalid_api_response",
      "ozon_response",
      response.status
    );
  }

  return diagnostic(
    true,
    "connected",
    200,
    null,
    "complete",
    response.status
  );
}
