
const API = "https://api-seller.ozon.ru";

export async function buildOzonFinanceReport() {
  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("Missing Ozon credentials");
  }

  const date = "2026-10-30";
  const totalsByType = new Map();
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
        signal: AbortSignal.timeout(20000)
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
        categories: Object.fromEntries(
          [...totalsByType].map(([name, amount]) => [
            name, amount / 100
          ])
        )
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
