
const API = "https://api-seller.ozon.ru";

export async function checkFinanceTypes() {
  if (process.env.OZON_READ_ONLY !== "true") {
    throw new Error("Read-only mode required");
  }

  const clientId = process.env.OZON_CLIENT_ID;
  const apiKey = process.env.OZON_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("Missing Ozon credentials");
  }

  const response = await fetch(
    `${API}/v1/finance/accrual/types`,
    {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!response.ok) {
    return {
      connected: false,
      httpStatus: response.status,
      complete: false
    };
  }

  const data = await response.json();

  if (!Array.isArray(data.accrual_types)) {
    throw new Error("Unexpected accrual types response");
  }

  const types = data.accrual_types;
  const ids = new Set();

  for (const type of types) {
    if (!Number.isInteger(type.id)) {
      throw new Error("Invalid accrual type ID");
    }

    if (ids.has(type.id)) {
      throw new Error("Duplicate accrual type ID");
    }

    ids.add(type.id);
  }

 
return {
  connected: true,
  httpStatus: 200,
  totalTypes: types.length,
  complete: true,
  types: types.map((type) => ({
    id: type.id,
    name: type.name,
    description: type.description
  }))
};
}
