
const API = "https://api-seller.ozon.ru";

export async function checkFbsOrders() {
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
  const usedCursors = new Set();

  let cursor = "";
  let pages = 0;
  let hasMore = false;
  let httpStatus = 200;

  do {
    if (pages >= 50) break;

    const response = await fetch(
      `${API}/v4/posting/fbs/list`,
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
            financial_data: false
          }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    httpStatus = response.status;

    if (!response.ok) {
      return {
        connected: false,
        httpStatus,
        pages,
        total: seen.size,
        complete: false,
        statuses
      };
    }

    const data = await response.json();
    pages++;

    if (!Array.isArray(data.postings)) {
      throw new Error("Unexpected FBS response format");
    }

    for (const posting of data.postings) {
      const id = posting.posting_number;

      if (!id || seen.has(id)) continue;

      seen.add(id);

      const status = posting.status || "unknown";
      statuses[status] = (statuses[status] || 0) + 1;
    }

    hasMore = data.has_next === true;

    if (!hasMore) break;

    if (!data.cursor || usedCursors.has(data.cursor)) {
      throw new Error("Invalid FBS pagination cursor");
    }

    usedCursors.add(data.cursor);
    cursor = data.cursor;

  } while (hasMore);

  return {
    connected: true,
    httpStatus,
    pages,
    total: seen.size,
    complete: !hasMore,
    statuses
  };
}
