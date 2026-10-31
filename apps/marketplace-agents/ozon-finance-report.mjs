
const API = "https://api-seller.ozon.ru";

const FINANCE_REFERENCE = {
  date: "2026-10-30",
  totalKopecks: 4108800,
  categories: {
    POSTING: 6322841,
    ITEM: -164263,
    NON_ITEM: -2049778
  }
};

function reconcileFinanceReport(date, totalKopecks, totalsByType) {
  if (date !== FINANCE_REFERENCE.date) {
    return {
      status: "not_checked",
      reason: "No reference for this date"
    };
  }

  const differences = [];

  if (totalKopecks !== FINANCE_REFERENCE.totalKopecks) {
    differences.push("control_total_mismatch");
  }

  for (const [category, expected] of Object.entries(
    FINANCE_REFERENCE.categories
  )) {
    if ((totalsByType.get(category) ?? 0) !== expected) {
      differences.push(`${category}_mismatch`);
    }
  }

  return {
    status: differences.length === 0 ? "matched" : "mismatch",
    differences
  };
}


export async function buildOzonFinanceReport(
  date = "2026-10-30",
  signal
) {
  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("Missing Ozon credentials");
  }

  const totalsByType = new Map();
  const feeDetails = new Map();
  const usedCursors = new Set();

  let lastId = "";
  let pages = 0;
  let records = 0;
  let totalKopecks = 0;

  while (pages < 20) {
    const response = await fetch(
      `${API}/v1/finance/accrual/by-day`,
      {
        method: "POST",
        headers: {
          "Client-Id": clientId,
          "Api-Key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ date, last_id: lastId }),
        signal: signal
  ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
  : AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      return {
        httpStatus: response.status,
        complete: false
      };
    }

    const data = await response.json();

    if (!Array.isArray(data.accruals)) {
      throw new Error("Invalid finance response");
    }

    pages++;

    for (const item of data.accruals) {
      const raw = item.total_amount?.amount;

      if (typeof raw !== "string" ||
          !/^-?\d+(\.\d{1,2})?$/.test(raw)) {
        throw new Error("Invalid monetary amount");
      }

      if (item.total_amount.currency !== "RUB") {
        throw new Error("Unexpected currency");
      }

      const negative = raw.startsWith("-");
      const [rub, kop = ""] = raw.replace("-", "").split(".");

      const kopecks =
        (Number(rub) * 100 + Number(kop.padEnd(2, "0"))) *
        (negative ? -1 : 1);

      if (!Number.isSafeInteger(kopecks)) {
        throw new Error("Amount out of range");
      }

      totalKopecks += kopecks;
      records++;

      const category = item.accrued_category || "UNSPECIFIED";

      totalsByType.set(
        category,
        (totalsByType.get(category) || 0) + kopecks
      );
      
      // Детализация для анализа, не добавляется
      // повторно в контрольный финансовый итог.
      function collectFee(fee) {
        if (!fee || typeof fee !== "object") return;

        const typeId = fee.type_id;
        const money = fee.accrued;

        if (!Number.isInteger(typeId) || !money) return;

        const value = money.amount;

        if (money.currency !== "RUB" ||
            typeof value !== "string" ||
            !/^-?\d+(\.\d{1,2})?$/.test(value)) {
          throw new Error("Invalid fee amount");
        }

        const negative = value.startsWith("-");
        const [rubles, decimals = ""] =
          value.replace("-", "").split(".");

        const cents =
          (Number(rubles) * 100 +
          Number(decimals.padEnd(2, "0"))) *
          (negative ? -1 : 1);

        if (!Number.isSafeInteger(cents)) {
          throw new Error("Fee amount out of range");
        }

        const key = `${category}:${typeId}`;
        const previous = feeDetails.get(key) || {
          category,
          typeId,
          count: 0,
          kopecks: 0
        };

        previous.count++;
        previous.kopecks += cents;

        if (!Number.isSafeInteger(previous.kopecks)) {
          throw new Error("Fee total out of range");
        }

        feeDetails.set(key, previous);
      }

      for (const group of item.container_fees?.fees ?? []) {
        collectFee(group);
      }

      for (const group of item.item_fees?.fees ?? []) {
        for (const fee of group.fees ?? []) {
          collectFee(fee);
        }
      }

      if (item.non_item_fee?.type_id !== undefined) {
        collectFee({
          type_id: item.non_item_fee.type_id,
          accrued: item.non_item_fee.accrued
        });
      }

      for (const product of item.posting?.products ?? []) {
        for (const service of product.delivery?.services ?? []) {
          collectFee(service);
        }
      }

    }

    const nextId = data.last_id || "";

    if (!nextId) {
      return {
        check: "ozon_finance_report",
        date,
        httpStatus: 200,
        pages,
        records,
        complete: true,
        currency: "RUB",
        controlTotal: totalKopecks / 100,
        reconciliation: reconcileFinanceReport(date, totalKopecks, totalsByType),
        
categories: Object.fromEntries(
  [...totalsByType].map(([name, amount]) => [
    name, amount / 100
  ])
),
feeDetails: [...feeDetails.values()]
  .sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.typeId - b.typeId
  )
  .map(({ category, typeId, count, kopecks }) => ({
    category,
    typeId,
    count,
    amount: kopecks / 100
  }))

      };
    }

    if (usedCursors.has(nextId)) {
      throw new Error("Repeated finance cursor");
    }

    usedCursors.add(nextId);
    lastId = nextId;
  }

  return {
    check: "ozon_finance_report",
    date,
    pages,
    records,
    complete: false
  };
}

export async function buildOzonMonthlyReport(
  year = 2026,
  month = 10,
  signal
) {
  if (!Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 || month > 12) {
    throw new Error("Invalid reporting period");
  }

  const daysInMonth = new Date(
    Date.UTC(year, month, 0)
  ).getUTCDate();

  const dailyReports = [];
  const categoryTotals = new Map();

  let totalKopecks = 0;
  let totalRecords = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = [
      year,
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");

   if (signal?.aborted) {
  throw new Error("Monthly run aborted");
}

const result = await buildOzonFinanceReport(date, signal);

    if (!result.complete || result.httpStatus !== 200) {
      return {
        check: "ozon_monthly_finance",
        period: `${year}-${String(month).padStart(2, "0")}`,
        complete: false,
        failedDate: date,
        processedDays: dailyReports.length
      };
    }

    const toKopecks = (value) => {
      const n = Math.round(value * 100);
      if (!Number.isSafeInteger(n)) {
        throw new Error("Invalid monthly amount");
      }
      return n;
    };

    totalKopecks += toKopecks(result.controlTotal);
    totalRecords += result.records;

    for (const [category, amount] of Object.entries(
      result.categories
    )) {
      categoryTotals.set(
        category,
        (categoryTotals.get(category) ?? 0) +
        toKopecks(amount)
      );
    }

    dailyReports.push({
      date,
      records: result.records,
      controlTotal: result.controlTotal,
      reconciliation: result.reconciliation
    });
    
    const categoryKopecks = Object.values(
      result.categories
    ).reduce(
      (sum, amount) => sum + toKopecks(amount),
      0
    );

    if (categoryKopecks !== toKopecks(result.controlTotal)) {
      throw new Error(
        `Financial category mismatch for ${date}`
      );
    }

  }

  return {
    check: "ozon_monthly_finance",
    period: `${year}-${String(month).padStart(2, "0")}`,
    complete: true,
    reconciled: false,
final: false,
    processedDays: dailyReports.length,
    records: totalRecords,
    currency: "RUB",
    controlTotal: totalKopecks / 100,
    categories: Object.fromEntries(
      [...categoryTotals].map(([name, amount]) => [
        name, amount / 100
      ])
    ),
    dailyReports
  };
}
