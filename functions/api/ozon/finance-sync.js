const OZON_API = "https://api-seller.ozon.ru";
const SOURCE = "ozon_seller_api";
const DEFAULT_LOOKBACK_DAYS = 3;
const DEFAULT_MAX_PAGES_PER_DAY = 40;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 20000;
const MIN_REQUEST_INTERVAL_MS = 1000;
const MAX_RETRY_AFTER_MS = 10 * 60 * 1000;
const MAX_D1_BATCH_SIZE = 50;
const OZON_CURSOR_TTL_MS = 14 * 60 * 1000;

export class FinanceSyncError extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.name = "FinanceSyncError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isRecord(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function safeIntegerFromBigInt(value, field) {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new FinanceSyncError(`invalid_${field}`);
  }

  return Number(value);
}

export function moneyToKopecks(value, currency) {
  if (
    currency !== "RUB" ||
    typeof value !== "string" ||
    !/^-?\d{1,14}(?:\.\d{1,2})?$/.test(value)
  ) {
    throw new FinanceSyncError("invalid_money");
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const magnitude =
    BigInt(whole) * 100n +
    BigInt(fraction.padEnd(2, "0") || "0");

  return safeIntegerFromBigInt(
    negative ? -magnitude : magnitude,
    "money"
  );
}

function validDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value);
  if (!match) return null;

  const date = new Date(`${match[1]}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : null;
}

function accrualId(value) {
  const id = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;

  if (
    typeof id !== "string" ||
    !/^\d{1,30}$/.test(id)
  ) {
    throw new FinanceSyncError("invalid_accrual_id");
  }

  return id;
}

function skuId(value) {
  const sku = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;

  if (
    typeof sku !== "string" ||
    !/^\d{1,30}$/.test(sku)
  ) {
    throw new FinanceSyncError("invalid_sku");
  }

  return sku;
}

function invalidDetails(path, value, parentArrayCount) {
  const type = value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
  const count = Array.isArray(value)
    ? value.length
    : parentArrayCount;
  const countSuffix = count === undefined ? "" : `_count_${count}`;
  throw new FinanceSyncError(
    `invalid_details_${path}_${type}${countSuffix}`
  );
}

function normalizeComponents(accrual, id) {
  if (accrual.item_fees === undefined || accrual.item_fees === null) {
    return [];
  }
  if (!isRecord(accrual.item_fees)) {
    invalidDetails("item_fees", accrual.item_fees);
  }

  const groups = accrual.item_fees.fees === undefined
    ? []
    : accrual.item_fees.fees;
  if (!Array.isArray(groups)) {
    invalidDetails("item_fees_fees", groups);
  }

  const amounts = new Map();

  for (const group of groups) {
    if (!isRecord(group)) {
      invalidDetails("item_fees_group", group, groups.length);
    }

    if (group.fees === undefined) continue;
    if (!Array.isArray(group.fees)) {
      invalidDetails(
        "item_fees_group_fees",
        group.fees,
        groups.length
      );
    }
    if (group.fees.length === 0) continue;

    const sku = skuId(group.sku);

    for (const fee of group.fees) {
      if (
        !isRecord(fee)
      ) {
        invalidDetails(
          "item_fees_fee",
          fee,
          group.fees.length
        );
      }

      if (!Number.isSafeInteger(fee.type_id) || fee.type_id < 0) {
        invalidDetails(
          "item_fees_fee_type_id",
          fee.type_id,
          group.fees.length
        );
      }
      if (!isRecord(fee.accrued)) {
        invalidDetails(
          "item_fees_fee_accrued",
          fee.accrued,
          group.fees.length
        );
      }

      const cents = moneyToKopecks(
        fee.accrued.amount,
        fee.accrued.currency
      );
      const key = `${sku}:${fee.type_id}`;
      const amount = (amounts.get(key) || 0) + cents;

      if (!Number.isSafeInteger(amount)) {
        throw new FinanceSyncError("invalid_component_amount");
      }

      amounts.set(key, amount);
    }
  }

  return [...amounts].map(([key, amount]) => {
    const separator = key.lastIndexOf(":");
    const sku = key.slice(0, separator);
    const typeId = Number(key.slice(separator + 1));

    return {
      componentId: `${id}:${sku}:${typeId}`,
      sku,
      typeId,
      amountKopecks: amount
    };
  });
}

function normalizeAccrual(value, requestedDate) {
  if (!isRecord(value)) {
    throw new FinanceSyncError("invalid_accrual");
  }

  const id = accrualId(value.accrual_id);
  const operationDate = validDate(value.date);

  if (!operationDate || operationDate !== requestedDate) {
    throw new FinanceSyncError("invalid_accrual_date");
  }

  const total = value.total_amount;
  if (!isRecord(total)) {
    throw new FinanceSyncError("invalid_accrual_amount");
  }

  if (
    value.accrued_category !== undefined &&
    typeof value.accrued_category !== "string"
  ) {
    throw new FinanceSyncError("invalid_accrual_category");
  }

  if (
    value.unit_number !== undefined &&
    value.unit_number !== null &&
    typeof value.unit_number !== "string"
  ) {
    throw new FinanceSyncError("invalid_accrual_unit");
  }

  return {
    id,
    operationDate,
    period: operationDate.slice(0, 7),
    category: value.accrued_category || "UNSPECIFIED",
    unitNumber: value.unit_number || null,
    totalKopecks: moneyToKopecks(total.amount, total.currency),
    components: normalizeComponents(value, id)
  };
}

function normalizeAccrualPage(data, date) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.accruals) ||
    typeof data.last_id !== "string"
  ) {
    throw new FinanceSyncError("invalid_accrual_response");
  }

  const unique = new Map();
  for (const rawAccrual of data.accruals) {
    const accrual = normalizeAccrual(rawAccrual, date);
    unique.set(accrual.id, accrual);
  }

  return {
    accruals: [...unique.values()],
    nextCursor: data.last_id
  };
}

function normalizeTypes(data) {
  if (!isRecord(data) || !Array.isArray(data.accrual_types)) {
    throw new FinanceSyncError("invalid_accrual_types_response");
  }

  const unique = new Map();

  for (const type of data.accrual_types) {
    if (
      !isRecord(type) ||
      !Number.isSafeInteger(type.id) ||
      type.id < 0 ||
      typeof type.name !== "string" ||
      (
        type.description !== undefined &&
        type.description !== null &&
        typeof type.description !== "string"
      )
    ) {
      throw new FinanceSyncError("invalid_accrual_type");
    }

    unique.set(type.id, {
      id: type.id,
      name: type.name,
      description: type.description || ""
    });
  }

  return [...unique.values()];
}

function moscowDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function getOzonDateWindow(
  now = new Date(),
  days = DEFAULT_LOOKBACK_DAYS
) {
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > DEFAULT_LOOKBACK_DAYS
  ) {
    throw new FinanceSyncError("invalid_sync_window");
  }

  const currentDate = moscowDate(now);
  const [year, month, day] = currentDate.split("-").map(Number);
  const dates = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(year, month - 1, day - offset - 1));
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
}

function retryAfterMilliseconds(response, now) {
  const value = response.headers.get("Retry-After");
  if (!value) return null;

  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.max(0, Number(value) * 1000);
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? null
    : Math.max(0, timestamp - now);
}

function timeoutError(error) {
  return error?.name === "TimeoutError" ||
    error?.name === "AbortError";
}

function safeErrorCode(error) {
  return error instanceof FinanceSyncError
    ? error.code
    : "sync_internal_error";
}

function prepared(db, sql, values) {
  return db.prepare(sql).bind(...values);
}

async function batch(db, statements) {
  for (
    let offset = 0;
    offset < statements.length;
    offset += MAX_D1_BATCH_SIZE
  ) {
    await db.batch(
      statements.slice(offset, offset + MAX_D1_BATCH_SIZE)
    );
  }
}

function accrualStatements(db, accrual) {
  const statements = [
    prepared(db, `
      DELETE FROM ozon_api_accrual_components
      WHERE accrual_id = ?
        AND EXISTS (
          SELECT 1 FROM ozon_api_accruals
          WHERE accrual_id = ? AND reconciled = 0
        )
    `, [accrual.id, accrual.id]),
    prepared(db, `
      INSERT INTO ozon_api_accruals (
        accrual_id,
        operation_date,
        period,
        accrued_category,
        unit_number,
        total_kopecks,
        currency,
        source,
        reconciled,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'RUB', ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(accrual_id) DO UPDATE SET
        operation_date = excluded.operation_date,
        period = excluded.period,
        accrued_category = excluded.accrued_category,
        unit_number = excluded.unit_number,
        total_kopecks = excluded.total_kopecks,
        currency = excluded.currency,
        source = excluded.source,
        reconciled = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE ozon_api_accruals.reconciled = 0
    `, [
      accrual.id,
      accrual.operationDate,
      accrual.period,
      accrual.category,
      accrual.unitNumber,
      accrual.totalKopecks,
      SOURCE
    ])
  ];

  for (const component of accrual.components) {
    statements.push(prepared(db, `
      INSERT INTO ozon_api_accrual_components (
        component_id,
        accrual_id,
        sku,
        type_id,
        amount_kopecks,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(component_id) DO UPDATE SET
        accrual_id = excluded.accrual_id,
        sku = excluded.sku,
        type_id = excluded.type_id,
        amount_kopecks = excluded.amount_kopecks,
        updated_at = CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1 FROM ozon_api_accruals
        WHERE accrual_id = excluded.accrual_id
          AND reconciled = 0
      )
    `, [
      component.componentId,
      accrual.id,
      component.sku,
      component.typeId,
      component.amountKopecks
    ]));
  }

  return statements;
}

function componentFingerprint(components) {
  const normalized = [...components]
    .map(component => [
      component.sku,
      component.typeId,
      component.amountKopecks
    ])
    .sort((left, right) =>
      `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`)
    );
  return JSON.stringify(normalized);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dateFromSqlite(value) {
  if (typeof value !== "string") return null;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : timestamp;
}

async function persistenceStatements(db, accruals) {
  const statements = [];
  const byId = new Map();

  for (let offset = 0; offset < accruals.length; offset += MAX_D1_BATCH_SIZE) {
    const chunk = accruals.slice(offset, offset + MAX_D1_BATCH_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const ids = chunk.map(accrual => accrual.id);
    const existing = await db.prepare(`
      SELECT accrual_id, operation_date, accrued_category, unit_number,
             total_kopecks, currency, reconciled
      FROM ozon_api_accruals
      WHERE accrual_id IN (${placeholders})
    `).bind(...ids).all();
    const components = await db.prepare(`
      SELECT accrual_id, sku, type_id, amount_kopecks
      FROM ozon_api_accrual_components
      WHERE accrual_id IN (${placeholders})
      ORDER BY accrual_id, sku, type_id
    `).bind(...ids).all();

    for (const row of existing.results || []) {
      byId.set(row.accrual_id, row);
    }

    const componentsById = new Map();
    for (const component of components.results || []) {
      const current = componentsById.get(component.accrual_id) || [];
      current.push({
        sku: component.sku,
        typeId: component.type_id,
        amountKopecks: component.amount_kopecks
      });
      componentsById.set(component.accrual_id, current);
    }

    for (const accrual of chunk) {
      const previous = byId.get(accrual.id);
      if (!previous || previous.reconciled !== 1) continue;

      const previousComponents = componentsById.get(accrual.id) || [];
      const oldFingerprint = await sha256(
        componentFingerprint(previousComponents)
      );
      const newFingerprint = await sha256(
        componentFingerprint(accrual.components)
      );
      const changed = previous.operation_date !== accrual.operationDate ||
        previous.accrued_category !== accrual.category ||
        previous.unit_number !== accrual.unitNumber ||
        previous.total_kopecks !== accrual.totalKopecks ||
        previous.currency !== "RUB" ||
        oldFingerprint !== newFingerprint;

      if (!changed) continue;

      const discrepancyId = await sha256(JSON.stringify([
        accrual.id,
        accrual.operationDate,
        accrual.unitNumber,
        accrual.category,
        accrual.totalKopecks,
        newFingerprint
      ]));
      statements.push(prepared(db, `
        INSERT INTO ozon_api_accrual_discrepancies (
          discrepancy_id,
          accrual_id,
          previous_date,
          previous_unit_number,
          previous_category,
          previous_total_kopecks,
          observed_date,
          observed_unit_number,
          observed_category,
          observed_total_kopecks,
          previous_components_hash,
          observed_components_hash,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
        ON CONFLICT(discrepancy_id) DO NOTHING
      `, [
        discrepancyId,
        accrual.id,
        previous.operation_date,
        previous.unit_number,
        previous.accrued_category,
        previous.total_kopecks,
        accrual.operationDate,
        accrual.unitNumber,
        accrual.category,
        accrual.totalKopecks,
        oldFingerprint,
        newFingerprint
      ]));
    }
  }

  for (const accrual of accruals) {
    const previous = byId.get(accrual.id);
    if (previous?.reconciled === 1) continue;
    statements.push(...accrualStatements(db, accrual));
  }

  return statements;
}

export async function syncOzonFinance(
  env,
  {
    now = new Date(),
    dates: requestedDates,
    fetchImpl = fetch,
    runId: requestedRunId,
    sleep = milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds)),
    minRequestIntervalMs = MIN_REQUEST_INTERVAL_MS,
    maxPagesPerDay = DEFAULT_MAX_PAGES_PER_DAY,
    lockToken: requestedLockToken,
    runAlreadyCreated = false
  } = {}
) {
  const db = env?.OZON_FINANCE_DB;
  if (!db) throw new FinanceSyncError("database_unavailable");

  const dates = requestedDates || getOzonDateWindow(now);
  if (
    !Array.isArray(dates) ||
    dates.length < 1 ||
    dates.length > DEFAULT_LOOKBACK_DAYS ||
    dates.some(date => !validDate(date) || date !== validDate(date)) ||
    new Set(dates).size !== dates.length
  ) {
    throw new FinanceSyncError("invalid_sync_dates");
  }

  if (
    !Number.isInteger(maxPagesPerDay) ||
    maxPagesPerDay < 1 ||
    maxPagesPerDay > DEFAULT_MAX_PAGES_PER_DAY
  ) {
    throw new FinanceSyncError("invalid_page_limit");
  }

  const runId = requestedRunId || crypto.randomUUID();
  if (typeof runId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(runId)) {
    throw new FinanceSyncError("invalid_run_id");
  }
  if (
    requestedLockToken !== undefined &&
    (typeof requestedLockToken !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(requestedLockToken))
  ) {
    throw new FinanceSyncError("invalid_sync_lock_token");
  }
  if (runAlreadyCreated && !requestedLockToken) {
    throw new FinanceSyncError("invalid_sync_lock_token");
  }
  const nowText = now.toISOString();
  const nowMilliseconds = now.getTime();
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const counters = {
    pages: 0,
    records: 0,
    retries: 0,
    completedDates: 0,
    typesSynced: false,
    errorCode: null
  };

  if (!runAlreadyCreated) {
    await db.prepare(`
      INSERT INTO ozon_api_sync_runs (
        run_id,
        source,
        period_start,
        period_end,
        status,
        started_at
      )
      VALUES (?, ?, ?, ?, 'running', ?)
    `).bind(runId, SOURCE, startDate, endDate, nowText).run();
  }

  const lockToken = requestedLockToken || crypto.randomUUID();
  let ownsLock = false;

  try {
    const lock = requestedLockToken
      ? await db.prepare(`
          SELECT lock_token
          FROM ozon_api_sync_lock
          WHERE lock_id = 1
            AND lock_token = ?
            AND datetime(locked_until) > CURRENT_TIMESTAMP
        `).bind(lockToken).first()
      : await db.prepare(`
          INSERT INTO ozon_api_sync_lock (
            lock_id,
            lock_token,
            locked_until
          )
          VALUES (1, ?, datetime('now', '+20 minutes'))
          ON CONFLICT(lock_id) DO UPDATE SET
            lock_token = excluded.lock_token,
            locked_until = excluded.locked_until
          WHERE datetime(ozon_api_sync_lock.locked_until)
            <= CURRENT_TIMESTAMP
          RETURNING lock_token
        `).bind(lockToken).first();

    if (!lock) {
      await finishRun(db, runId, counters, "skipped", "sync_already_running");
      return {
        runId,
        status: "skipped",
        errorCode: "sync_already_running"
      };
    }
    ownsLock = true;

    try {
      if (!env.OZON_CLIENT_ID || !env.OZON_API_KEY) {
        throw new FinanceSyncError("ozon_credentials_missing");
      }

      const clientId = env.OZON_CLIENT_ID;
      const apiKey = env.OZON_API_KEY;
      let lastRequestAt = 0;

      const requestJson = async (path, body) => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const elapsed = Date.now() - lastRequestAt;
          if (elapsed < minRequestIntervalMs) {
            await sleep(minRequestIntervalMs - elapsed);
          }

          lastRequestAt = Date.now();
          let response;

          try {
            response = await fetchImpl(`${OZON_API}${path}`, {
              method: "POST",
              headers: {
                "Client-Id": clientId,
                "Api-Key": apiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
          } catch (error) {
            if (attempt === MAX_RETRIES) {
              throw new FinanceSyncError(
                timeoutError(error)
                  ? "ozon_request_timeout"
                  : "ozon_network_error"
              );
            }

            counters.retries++;
            await sleep(1000 * (2 ** attempt));
            continue;
          }

          if (!response.ok) {
            const retryable = response.status === 429 ||
              response.status >= 500;

            if (!retryable || attempt === MAX_RETRIES) {
              throw new FinanceSyncError(
                response.status === 429
                  ? "ozon_rate_limited"
                  : `ozon_http_${response.status}`,
                response.status
              );
            }

            const retryAfter = response.status === 429
              ? retryAfterMilliseconds(response, Date.now())
              : null;

            if (
              retryAfter !== null &&
              retryAfter > MAX_RETRY_AFTER_MS
            ) {
              throw new FinanceSyncError(
                "ozon_retry_after_too_long",
                response.status
              );
            }

            counters.retries++;
            await sleep(
              Math.max(
                retryAfter ?? 0,
                1000 * (2 ** attempt)
              )
            );
            continue;
          }

          let responseText;

          try {
            responseText = await response.text();
          } catch (error) {
            if (attempt === MAX_RETRIES) {
              throw new FinanceSyncError(
                timeoutError(error)
                  ? "ozon_request_timeout"
                  : "ozon_network_error",
                response.status
              );
            }

            counters.retries++;
            await sleep(1000 * (2 ** attempt));
            continue;
          }

          let data;
          try {
            data = JSON.parse(responseText);
          } catch {
            throw new FinanceSyncError(
              "ozon_invalid_api_response",
              response.status
            );
          }

          return data;
        }

        throw new FinanceSyncError("ozon_retry_exhausted");
      };

      try {
        const typeResponse = await requestJson(
          "/v1/finance/accrual/types",
          {}
        );
        const types = normalizeTypes(typeResponse);
        const statements = types.map(type => prepared(db, `
          INSERT INTO ozon_api_accrual_types (
            type_id,
            name,
            description,
            updated_at
          )
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(type_id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            updated_at = CURRENT_TIMESTAMP
        `, [type.id, type.name, type.description]));

        await batch(db, statements);
        counters.typesSynced = true;
      } catch (error) {
        counters.errorCode = safeErrorCode(error);
      }

      let stopAfterDate = [
        "ozon_rate_limited",
        "ozon_retry_after_too_long",
        "ozon_request_timeout",
        "ozon_network_error",
        "sync_internal_error"
      ].includes(counters.errorCode);
      if (counters.errorCode?.startsWith("ozon_http_")) {
        stopAfterDate = true;
      }

      for (const date of dates) {
        if (stopAfterDate) break;

        const previousState = await db.prepare(`
          SELECT status, last_id, page_count, record_count, updated_at
          FROM ozon_api_sync_state
          WHERE sync_date = ? AND source = ?
        `).bind(date, SOURCE).first();
        const previousUpdatedAt = dateFromSqlite(previousState?.updated_at);
        const canResume = Boolean(
          previousState?.last_id &&
          ["partial", "running"].includes(previousState.status) &&
          previousUpdatedAt !== null &&
          nowMilliseconds - previousUpdatedAt < OZON_CURSOR_TTL_MS
        );
        let cursor = canResume ? previousState.last_id : "";
        let pages = canResume ? previousState.page_count : 0;
        let pagesThisRun = 0;
        let records = canResume ? previousState.record_count : 0;
        let completed = false;
        const seenCursors = new Set(
          cursor ? [cursor] : []
        );

        await db.prepare(`
          INSERT INTO ozon_api_sync_state (
            sync_date,
            source,
            status,
            last_id,
            page_count,
            record_count,
            page_complete,
            reconciled,
            last_error_code,
            last_started_at,
            last_completed_at,
            updated_at
          )
          VALUES (?, ?, 'running', ?, ?, ?, 0, 0, NULL, ?, NULL, CURRENT_TIMESTAMP)
          ON CONFLICT(sync_date) DO UPDATE SET
            source = excluded.source,
            status = 'running',
            last_id = excluded.last_id,
            page_count = excluded.page_count,
            record_count = excluded.record_count,
            page_complete = 0,
            last_error_code = NULL,
            last_started_at = excluded.last_started_at,
            last_completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          date,
          SOURCE,
          cursor,
          pages,
          records,
          nowText
        ).run();

        try {
          while (pagesThisRun < maxPagesPerDay) {
            const page = normalizeAccrualPage(
              await requestJson(
                "/v1/finance/accrual/by-day",
                { date, last_id: cursor }
              ),
              date
            );

            const statements = await persistenceStatements(
              db,
              page.accruals
            );
            await batch(db, statements);

            pages++;
            pagesThisRun++;
            records += page.accruals.length;
            counters.pages++;
            counters.records += page.accruals.length;

            const repeatedCursor = page.nextCursor &&
              seenCursors.has(page.nextCursor);
            const nextCursor = repeatedCursor
              ? cursor
              : page.nextCursor;

            await db.prepare(`
              UPDATE ozon_api_sync_state
              SET last_id = ?,
                  page_count = ?,
                  record_count = ?,
                  last_error_code = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE sync_date = ?
            `).bind(
              nextCursor,
              pages,
              records,
              repeatedCursor
                ? "pagination_cursor_repeated"
                : null,
              date
            ).run();

            if (repeatedCursor) {
              throw new FinanceSyncError(
                "pagination_cursor_repeated"
              );
            }

            if (!page.nextCursor) {
              completed = true;
              break;
            }

            seenCursors.add(page.nextCursor);
            cursor = page.nextCursor;
          }

          if (!completed) {
            throw new FinanceSyncError("page_limit_reached");
          }

          await db.prepare(`
            UPDATE ozon_api_sync_state
            SET status = 'complete',
                last_id = '',
                page_complete = 1,
                reconciled = CASE
                  WHEN EXISTS (
                    SELECT 1 FROM ozon_api_accruals
                    WHERE operation_date = ? AND source = ?
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM ozon_api_accruals
                    WHERE operation_date = ? AND source = ?
                      AND reconciled = 0
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM ozon_api_accrual_discrepancies
                    JOIN ozon_api_accruals USING (accrual_id)
                    WHERE operation_date = ? AND source = ?
                      AND status = 'open'
                  )
                  THEN 1 ELSE 0
                END,
                last_error_code = NULL,
                last_completed_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE sync_date = ?
          `).bind(
            date,
            SOURCE,
            date,
            SOURCE,
            date,
            SOURCE,
            new Date().toISOString(),
            date
          ).run();
          counters.completedDates++;
        } catch (error) {
          const code = safeErrorCode(error);
          if (!counters.errorCode) counters.errorCode = code;

          await db.prepare(`
            UPDATE ozon_api_sync_state
            SET status = ?,
                last_id = ?,
                page_complete = 0,
                reconciled = 0,
                last_error_code = ?,
                last_completed_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE sync_date = ?
          `).bind(
            pages > 0 ? "partial" : "failed",
            cursor,
            code,
            new Date().toISOString(),
            date
          ).run();

          if (
            code === "ozon_rate_limited" ||
            code === "ozon_retry_after_too_long" ||
            code === "ozon_request_timeout" ||
            code === "ozon_network_error" ||
            code.startsWith("ozon_http_") ||
            code === "sync_internal_error"
          ) {
            stopAfterDate = true;
          }
        }
      }
    } catch (error) {
      if (!counters.errorCode) {
        counters.errorCode = safeErrorCode(error);
      }
    }

    const allDaysComplete = counters.completedDates === dates.length;
    const status = allDaysComplete && counters.typesSynced
      ? "complete"
      : counters.completedDates > 0 ||
          counters.pages > 0
        ? "partial"
        : "failed";

    await finishRun(
      db,
      runId,
      counters,
      status,
      counters.errorCode
    );

    return {
      runId,
      status,
      periodStart: startDate,
      periodEnd: endDate,
      pageCount: counters.pages,
      recordCount: counters.records,
      retryCount: counters.retries,
      typesSynced: counters.typesSynced,
      errorCode: counters.errorCode
    };
  } finally {
    if (ownsLock) {
      await db.prepare(`
        UPDATE ozon_api_sync_lock
        SET lock_token = NULL,
            locked_until = '1970-01-01 00:00:00'
        WHERE lock_id = 1
          AND lock_token = ?
      `).bind(lockToken).run();
    }
  }
}

async function finishRun(db, runId, counters, status, errorCode) {
  await db.prepare(`
    UPDATE ozon_api_sync_runs
    SET status = ?,
        page_count = ?,
        record_count = ?,
        retry_count = ?,
        types_synced = ?,
        error_code = ?,
        finished_at = ?
    WHERE run_id = ?
  `).bind(
    status,
    counters.pages,
    counters.records,
    counters.retries,
    Number(counters.typesSynced),
    errorCode,
    new Date().toISOString(),
    runId
  ).run();
}
