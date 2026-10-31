
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

  const statuses = {};
  const seen = new Set();
  const cursors = new Set();

  let cursor = "";
  let pages = 0;
  let total = 0;
  let hasMore = false;

  do {
    if (pages >= 50) break;

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
          cursor,
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
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      return {
        connected: false,
        httpStatus: response.status,
        pages,
        total,
        complete: false
      };
    }

    const data = await response.json();
    pages++;

    for (const posting of data.postings ?? []) {
      const id = posting.posting_number;

      if (!id || seen.has(id)) continue;

      seen.add(id);
      total++;

      const status = posting.status || "unknown";
      statuses[status] = (statuses[status] || 0) + 1;
    }

    hasMore = data.has_next === true;

    if (!hasMore) break;

    if (!data.cursor || cursors.has(data.cursor)) {
      throw new Error("Invalid pagination cursor");
    }

    cursors.add(data.cursor);
    cursor = data.cursor;

  } while (hasMore);

  return {
    connected: true,
    httpStatus: 200,
    pages,
    total,
    complete: !hasMore,
    statuses
  };
}
