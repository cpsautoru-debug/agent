
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
  if (typeof expected !== "string" || !expected) {
    return false;
  }

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

function validPeriod(period) {
  return (
    typeof period === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
  );
}

function daysInPeriod(period) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(value, period) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.slice(0, 7) !== period
  ) {
    return false;
  }

  const date = new Date(value + "T00:00:00Z");

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function optionalText(value, maxLength) {
  return (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.length <= maxLength
    )
  );
}

function requiredText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

async function storeAccruals(report, db) {
  const { period, currency, operations } = report;

  if (
    !validPeriod(period) ||
    currency !== "RUB" ||
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > 25
  ) {
    return reply({ status: "invalid_accrual_batch" }, 400);
  }

  const ids = new Set();

  for (const op of operations) {
    if (
      !op ||
      typeof op !== "object" ||
      Array.isArray(op) ||
      !requiredText(op.operation_id, 150) ||
      !validDate(op.operation_date, period) ||
      !optionalText(op.sku, 150) ||
      !optionalText(op.seller_article, 250) ||
      !requiredText(op.category, 100) ||
      !optionalText(op.operation_type, 250) ||
      !integer(op.amount_kopecks) ||
      !optionalText(op.source, 100) ||
      ids.has(op.operation_id)
    ) {
      return reply({
        status: "invalid_operation",
        operationId:
          typeof op?.operation_id === "string"
            ? op.operation_id
            : null
      }, 400);
    }

    ids.add(op.operation_id);
  }

  const statement = db.prepare(`
    INSERT INTO ozon_accruals (
      operation_id,
      operation_date,
      sku,
      seller_article,
      category,
      operation_type,
      amount_kopecks,
      currency,
      source,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'RUB', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(operation_id) DO UPDATE SET
      operation_date = excluded.operation_date,
      sku = excluded.sku,
      seller_article = excluded.seller_article,
      category = excluded.category,
      operation_type = excluded.operation_type,
      amount_kopecks = excluded.amount_kopecks,
      currency = excluded.currency,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `);

  try {
    const statements = operations.map(op =>
      statement.bind(
        op.operation_id,
        op.operation_date,
        op.sku ?? null,
        op.seller_article ?? null,
        op.category,
        op.operation_type ?? null,
        op.amount_kopecks,
        op.source ?? "ozon_import"
      )
    );

    await db.batch(statements);

    return reply({
      status: "accruals_stored",
      period,
      received: operations.length,
      uniqueOperationIds: ids.size,
      databaseWrites: true
    });
  } catch {
    return reply({ status: "storage_error" }, 503);
  }
}

async function storeMonthlyReport(report, db) {
  const {
    period,
    currency,
    processedDays,
    records,
    postingKopecks,
    itemKopecks,
    nonItemKopecks,
    controlTotalKopecks,
    complete,
    reconciled,
    final
  } = report;

  if (
    !validPeriod(period) ||
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

  if (
    processedDays > daysInPeriod(period) ||
    (complete &&
      processedDays !== daysInPeriod(period)) ||
    postingKopecks +
      itemKopecks +
      nonItemKopecks !== controlTotalKopecks ||
    (reconciled && !complete) ||
    (final && (!complete || !reconciled))
  ) {
    return reply({ status: "failed_validation" }, 400);
  }

  try {
    await db.prepare(`
      INSERT INTO ozon_finance_reports (
        period,
        currency,
        processed_days,
        records_count,
        posting_kopecks,
        item_kopecks,
        non_item_kopecks,
        control_total_kopecks,
        complete,
        reconciled,
        final,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(period) DO UPDATE SET
        currency = excluded.currency,
        processed_days = excluded.processed_days,
        records_count = excluded.records_count,
        posting_kopecks = excluded.posting_kopecks,
        item_kopecks = excluded.item_kopecks,
        non_item_kopecks = excluded.non_item_kopecks,
        control_total_kopecks =
          excluded.control_total_kopecks,
        complete = excluded.complete,
        reconciled = excluded.reconciled,
        final = excluded.final,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      period,
      currency,
      processedDays,
      records,
      postingKopecks,
      itemKopecks,
      nonItemKopecks,
      controlTotalKopecks,
      Number(complete),
      Number(reconciled),
      Number(final)
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

  const contentLength = Number(
    request.headers.get("Content-Length")
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > 8192
  ) {
    return reply({ status: "payload_too_large" }, 413);
  }

  let report;

  try {
    const raw = await request.text();

    if (new TextEncoder().encode(raw).length > 8192) {
      return reply({ status: "payload_too_large" }, 413);
    }

    report = JSON.parse(raw);
  } catch {
    return reply({ status: "invalid_json" }, 400);
  }

  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report)
  ) {
    return reply({ status: "invalid_report" }, 400);
  }

  if (report.kind === "accruals") {
    return storeAccruals(report, env.OZON_FINANCE_DB);
  }

  if (report.kind !== undefined &&
      report.kind !== "monthly") {
    return reply({ status: "invalid_report_kind" }, 400);
  }

  return storeMonthlyReport(report, env.OZON_FINANCE_DB);
}
