
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function authorized(request, expected) {
  if (typeof expected !== "string" || !expected) return false;

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;

  const provided = new TextEncoder().encode(auth.slice(7));
  const secret = new TextEncoder().encode(expected);

  let diff = provided.length ^ secret.length;
  const length = Math.max(provided.length, secret.length);

  for (let i = 0; i < length; i++) {
    diff |= (provided[i] || 0) ^ (secret[i] || 0);
  }

  return diff === 0;
}

function integer(value) {
  return Number.isSafeInteger(value);
}

export async function onRequestPost({ request, env }) {
  if (!env.OZON_FINANCE_INGEST_TOKEN) {
    return reply({ status: "configuration_error" }, 503);
  }

  if (!authorized(request, env.OZON_FINANCE_INGEST_TOKEN)) {
    return reply({ status: "unauthorized" }, 401);
  }

  if (!env.OZON_FINANCE_DB) {
    return reply({ status: "database_unavailable" }, 503);
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    return reply({ status: "payload_too_large" }, 413);
  }

  let report;
  try {
    const raw = await request.text();
    if (raw.length > 8192) {
      return reply({ status: "payload_too_large" }, 413);
    }
    report = JSON.parse(raw);
  } catch {
    return reply({ status: "invalid_json" }, 400);
  }

  if (!report || typeof report !== "object" ||
      Array.isArray(report)) {
    return reply({ status: "invalid_report" }, 400);
  }

  const {
    period, currency, processedDays, records,
    postingKopecks, itemKopecks,
    nonItemKopecks, controlTotalKopecks,
    complete, reconciled, final
  } = report;

  if (
    typeof period !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
    currency !== "RUB" ||
    !integer(processedDays) ||
    processedDays < 1 ||
    processedDays > 31 ||
    !integer(records) ||
    records < 0 ||
    !integer(postingKopecks) ||
    !integer(itemKopecks) ||
    !integer(nonItemKopecks) ||
    !integer(controlTotalKopecks) ||
    typeof complete !== "boolean" ||
    typeof reconciled !== "boolean" ||
    typeof final !== "boolean"
  ) {
    return reply({ status: "invalid_fields" }, 400);
  }

  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0))
    .getUTCDate();

  if (
    processedDays > daysInMonth ||
    (complete && processedDays !== daysInMonth) ||
    postingKopecks + itemKopecks + nonItemKopecks
      !== controlTotalKopecks ||
    (reconciled && !complete) ||
    (final && (!complete || !reconciled))
  ) {
    return reply({ status: "failed_validation" }, 400);
  }

  try {
    await env.OZON_FINANCE_DB.prepare(`
      INSERT INTO ozon_finance_reports (
        period, currency, processed_days, records_count,
        posting_kopecks, item_kopecks, non_item_kopecks,
        control_total_kopecks, complete, reconciled,
        final, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                CURRENT_TIMESTAMP)
      ON CONFLICT(period) DO UPDATE SET
        currency = excluded.currency,
        processed_days = excluded.processed_days,
        records_count = excluded.records_count,
        posting_kopecks = excluded.posting_kopecks,
        item_kopecks = excluded.item_kopecks,
        non_item_kopecks = excluded.non_item_kopecks,
        control_total_kopecks = excluded.control_total_kopecks,
        complete = excluded.complete,
        reconciled = excluded.reconciled,
        final = excluded.final,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      period, currency, processedDays, records,
      postingKopecks, itemKopecks, nonItemKopecks,
      controlTotalKopecks,
      Number(complete), Number(reconciled), Number(final)
    ).run();

    return reply({
      status: "stored",
      period,
      databaseWrites: true
    });
  } catch {
    return reply({ status: "storage_error" }, 503);
  }
}
