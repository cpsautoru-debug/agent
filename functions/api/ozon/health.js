export async function onRequestGet() {
  return Response.json(
    {
      service: "autosklad63-ozon-finance",
      status: "ok",
      mode: "diagnostic",
      financialDataExposed: false
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
