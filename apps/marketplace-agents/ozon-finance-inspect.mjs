
const API = "https://api-seller.ozon.ru";

export async function inspectFinanceStructure() {
  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("Missing credentials");
  }

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
        date: "2026-10-30",
        last_id: ""
      }),
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!response.ok) {
    return { httpStatus: response.status, complete: false };
  }

  const data = await response.json();
  if (!Array.isArray(data.accruals)) {
    throw new Error("Unexpected response");
  }

  const fieldPaths = new Set();
  const typeIds = new Set();

  function inspect(obj, prefix = "", depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 5) return;

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      fieldPaths.add(path);

      if (key === "type_id" && Number.isInteger(value)) {
        typeIds.add(value);
      }

      if (Array.isArray(value)) {
        for (const item of value.slice(0, 20)) {
          inspect(item, path + "[]", depth + 1);
        }
      } else if (value && typeof value === "object") {
        inspect(value, path, depth + 1);
      }
    }
  }

  for (const item of data.accruals) {
    inspect(item);
  }

  return {
    check: "ozon_finance_structure",
    httpStatus: 200,
    date: "2026-10-30",
    inspectedRecords: data.accruals.length,
    complete: !data.last_id,
    fieldPaths: [...fieldPaths].sort(),
    typeIds: [...typeIds].sort((a, b) => a - b)
  };
}
