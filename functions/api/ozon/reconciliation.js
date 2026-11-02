import { verifySession } from "../auth/session.js";

const MAX_BODY_BYTES = 256 * 1024;
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,60}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const PREVIEW_STATUSES = ["ready_to_confirm", "already_net_verified"];
const CONFIRM_STATUSES = [
  "net_verified_details_unverified",
  "already_net_verified"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function readBoundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

function safeErrorCode(error) {
  const code = error?.code || error?.message;
  return typeof code === "string" && ERROR_CODE_PATTERN.test(code)
    ? code
    : null;
}

function safeReconciliationResult(value, statuses) {
  if (
    !value ||
    typeof value !== "object" ||
    !statuses.includes(value.status) ||
    typeof value.auditId !== "string" ||
    !/^ozon:\d{4}-\d{2}-\d{2}:[a-f0-9]{64}$/i.test(value.auditId) ||
    !Number.isSafeInteger(value.recordCount) ||
    value.recordCount < 1 ||
    !Number.isSafeInteger(value.totalKopecks) ||
    value.netStatus !== "verified" ||
    value.detailStatus !== "unverified" ||
    value.detailReason !== "ozon_api_component_mapping_incomplete"
  ) {
    return null;
  }

  const result = {
    status: value.status,
    auditId: value.auditId,
    recordCount: value.recordCount,
    totalKopecks: value.totalKopecks,
    netStatus: value.netStatus,
    detailStatus: value.detailStatus,
    detailReason: value.detailReason
  };

  if (value.status === "ready_to_confirm") {
    if (
      typeof value.operationDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.operationDate) ||
      typeof value.sourceReport !== "string" ||
      value.sourceReport.length > 200 ||
      typeof value.sourceSha256 !== "string" ||
      !HASH_PATTERN.test(value.sourceSha256) ||
      !Number.isSafeInteger(value.groupCount) ||
      value.groupCount < 1 ||
      typeof value.previewToken !== "string" ||
      value.previewToken.length > 256
    ) {
      return null;
    }

    Object.assign(result, {
      operationDate: value.operationDate,
      sourceReport: value.sourceReport,
      sourceSha256: value.sourceSha256,
      groupCount: value.groupCount,
      previewToken: value.previewToken
    });
  }

  return result;
}

function errorStatus(errorCode) {
  if (
    errorCode === "invalid_reconciliation_manifest" ||
    errorCode === "invalid_reconciliation_accrual" ||
    errorCode === "invalid_reconciliation_group" ||
    errorCode === "duplicate_reconciliation_group" ||
    errorCode === "reconciliation_control_total_mismatch"
  ) {
    return 400;
  }
  if (
    errorCode?.startsWith("reconciliation_") ||
    errorCode === "invalid_reconciliation_preview" ||
    errorCode === "reconciliation_preview_required" ||
    errorCode === "reconciliation_preview_expired"
  ) {
    return 409;
  }
  return 503;
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

    const raw = await readBoundedBody(request);
    if (raw === null) {
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
      !body.manifest ||
      typeof body.manifest !== "object" ||
      Array.isArray(body.manifest)
    ) {
      return json({ error: "Invalid reconciliation request" }, 400);
    }

    const service = env.OZON_FINANCE_SYNC;
    if (!service) return json({ error: "Finance service unavailable" }, 503);

    if (body.action === "preview") {
      if (
        Object.keys(body).some(key => !["action", "manifest"].includes(key)) ||
        typeof service.previewReconciliation !== "function"
      ) {
        return json({ error: "Invalid reconciliation request" }, 400);
      }
      const value = await service.previewReconciliation(body.manifest);
      const result = safeReconciliationResult(value, PREVIEW_STATUSES);
      if (!result) {
        return json({ error: "Invalid reconciliation response" }, 502);
      }
      return json(result);
    }

    if (body.action === "confirm") {
      if (
        Object.keys(body).some(key =>
          !["action", "manifest", "previewToken"].includes(key)
        ) ||
        typeof body.previewToken !== "string" ||
        typeof service.confirmReconciliation !== "function"
      ) {
        return json({ error: "Invalid reconciliation request" }, 400);
      }
      const value = await service.confirmReconciliation(
        body.manifest,
        body.previewToken
      );
      const result = safeReconciliationResult(value, CONFIRM_STATUSES);
      if (!result) {
        return json({ error: "Invalid reconciliation response" }, 502);
      }
      return json(result);
    }

    return json({ error: "Invalid reconciliation action" }, 400);
  } catch (error) {
    const errorCode = safeErrorCode(error);
    return json(
      { error: "Reconciliation unavailable", errorCode },
      errorStatus(errorCode)
    );
  }
}
