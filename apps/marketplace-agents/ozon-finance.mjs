
const API = "https://api-seller.ozon.ru";

export async function checkOzonFinance() {
  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("Missing Ozon credentials");
  }

  const date = "2026-10-30";
  const usedCursors = new Set();

  let lastId = "";
  let pages = 0;
  let records = 0;

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
        body: JSON.stringify({
          date,
          last_id: lastId
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      return {
        connected: false,
        httpStatus: response.status,
        pages,
        records,
        complete: false
      };
    }

    const data = await response.json();

    if (!Array.isArray(data.accruals)) {
      throw new Error("Unexpected finance response format");
    }

    pages++;
    records += data.accruals.length;

    const nextId = data.last_id || "";

    if (!nextId) {
      return {
        connected: true,
        httpStatus: 200,
        date,
        pages,
        records,
        complete: true
      };
    }

    if (usedCursors.has(nextId)) {
      throw new Error("Repeated finance cursor");
    }

    usedCursors.add(nextId);
    lastId = nextId;
  }

  return {
    connected: true,
    httpStatus: 200,
    date,
    pages,
    records,
    complete: false
  };
}
