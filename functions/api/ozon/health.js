
export async function onRequestGet({ env }) {
  const headers = {
    "Cache-Control": "no-store"
  };

  try {
    if (!env.OZON_FINANCE_DB) {
      return Response.json(
        { status: "error", database: "not_bound" },
        { status: 503, headers }
      );
    }

    await env.OZON_FINANCE_DB
      .prepare("SELECT 1 AS connected")
      .first();

    return Response.json(
      {
        service: "autosklad63-ozon-finance",
        status: "ok",
        database: "connected",
        financialDataExposed: false
      },
      { headers }
    );
  } catch {
    return Response.json(
      { status: "error", database: "unavailable" },
      { status: 503, headers }
    );
  }
}
