
const OZON_API = "https://api-seller.ozon.ru";

export async function checkOzonConnection() {
  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  if (!clientId || !apiKey) {
    throw new Error("Ozon credentials missing");
  }

  const response = await fetch(
    `${OZON_API}/v3/product/list`,
    {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: {
          visibility: "ALL"
        },
        limit: 1
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

  return {
    connected: true,
    httpStatus: response.status
  };
}
