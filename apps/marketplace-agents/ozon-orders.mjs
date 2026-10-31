
const API = "https://api-seller.ozon.ru";

export async function checkFboOrders() {
  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("Missing Ozon credentials");
  }

  const response = await fetch(
    `${API}/v3/posting/fbo/list`,
    {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cursor: "",
        filter: {
          since: "2026-09-30T20:00:00Z",
          to: "2026-10-31T20:00:00Z"
        },
        limit: 100,
        sort_dir: "asc",
        with: {
          analytics_data: false,
          financial_data: false,
          legal_info: false
        }
      }),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    return {
      connected: false,
      httpStatus: response.status
    };
  }

  const data = await response.json();

  return {
    connected: true,
    httpStatus: response.status,
    fetched: data.postings?.length ?? null,
    hasMore: Boolean(data.cursor)
  };
}
