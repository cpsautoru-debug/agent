
const COOKIE_NAME = "__Host-office_session";
const SESSION_SECONDS = 8 * 60 * 60;

function encode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(value) {
  const binary = atob(
    value.replace(/-/g, "+").replace(/_/g, "/")
  );
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function signingKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSession(googleSub, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(
    new TextEncoder().encode(JSON.stringify({
      sub: googleSub,
      iat: now,
      exp: now + SESSION_SECONDS
    }))
  );

  const signature = encode(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await signingKey(secret),
        new TextEncoder().encode(payload)
      )
    )
  );

  return [
    `${COOKIE_NAME}=${payload}.${signature}`,
    `Max-Age=${SESSION_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

export async function verifySession(request, secret) {
  if (!secret) return null;

  const header = request.headers.get("Cookie") || "";
  const cookie = header.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE_NAME + "="));

  if (!cookie) return null;

  try {
    const token = cookie.slice(COOKIE_NAME.length + 1);
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [payload, signature] = parts;

    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      decode(signature),
      new TextEncoder().encode(payload)
    );

    if (!valid) return null;

    const data = JSON.parse(
      new TextDecoder().decode(decode(payload))
    );

    const now = Math.floor(Date.now() / 1000);

    if (
      typeof data.sub !== "string" ||
      !data.sub ||
      !Number.isInteger(data.iat) ||
      !Number.isInteger(data.exp) ||
      data.iat > now ||
      data.exp <= now ||
      data.exp - data.iat !== SESSION_SECONDS
    ) {
      return null;
    }

    return data.sub;
  } catch {
    return null;
  }
}

export function clearSession() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
