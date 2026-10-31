
export async function onRequestPost({ request, env }) {
  const headers = {
    "Cache-Control": "no-store"
  };

  const unauthorized = () => Response.json(
    { status: "unauthorized" },
    { status: 401, headers }
  );

  const expected = env.OZON_FINANCE_INGEST_TOKEN;

  if (!expected) {
    return Response.json(
      { status: "configuration_error" },
      { status: 503, headers }
    );
  }

  const authorization = request.headers.get("Authorization") || "";
  const prefix = "Bearer ";

  if (!authorization.startsWith(prefix)) {
    return unauthorized();
  }

  const provided = authorization.slice(prefix.length);

  // Compare complete tokens without early character-by-character exits.
  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);

  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i++) {
    difference |= (a[i] || 0) ^ (b[i] || 0);
  }

  if (difference !== 0) {
    return unauthorized();
  }

  return Response.json(
    {
      status: "authorized",
      mode: "dry_run",
      databaseWrites: false
    },
    { headers }
  );
}
