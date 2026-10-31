
import { createSession } from "../session.js";

const ORIGIN = "https://autosklad63-office-staging.pages.dev";

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const prefix = name + "=";

  for (const part of cookies.split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      return item.slice(prefix.length);
    }
  }
  return null;
}

function decodeBase64url(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function parseJwtPart(part) {
  return JSON.parse(
    new TextDecoder().decode(decodeBase64url(part))
  );
}

async function verifyGoogleIdToken(token, clientId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");

  const header = parseJwtPart(parts[0]);
  const claims = parseJwtPart(parts[1]);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid signing algorithm");
  }

  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/certs"
  );
  if (!response.ok) throw new Error("Google keys unavailable");

  const { keys } = await response.json();
  const jwk = keys.find(
    key => key.kid === header.kid &&
      key.kty === "RSA" &&
      key.use === "sig"
  );
  if (!jwk) throw new Error("Signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );

  const now = Math.floor(Date.now() / 1000);

  if (
    !valid ||
    !["https://accounts.google.com", "accounts.google.com"]
      .includes(claims.iss) ||
    claims.aud !== clientId ||
    !Number.isInteger(claims.exp) ||
    claims.exp <= now ||
    !Number.isInteger(claims.iat) ||
    claims.iat > now + 60 ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    claims.email_verified !== true
  ) {
    throw new Error("Token verification failed");
  }

  return claims;
}

export async function onRequestGet({ request, env }) {
  const clearCookies = [
    "oauth_state=; Max-Age=0; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax",
    "oauth_verifier=; Max-Age=0; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax"
  ];

  function reply(message, status, sessionCookie = null) {
    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    });
    for (const cookie of clearCookies) {
      
    if (sessionCookie) {
      headers.append("Set-Cookie", sessionCookie);
    }

      headers.append("Set-Cookie", cookie);
    }
    return new Response(message, { status, headers });
  }

  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.OFFICE_ALLOWED_EMAIL
  ) {
    return reply("OAuth configuration incomplete", 503);
  }

  const url = new URL(request.url);
  if (url.origin !== ORIGIN) {
    return reply("Invalid origin", 403);
  }

  const state = url.searchParams.get("state");
  const savedState = getCookie(request, "oauth_state");
  const verifier = getCookie(request, "oauth_verifier");
  const code = url.searchParams.get("code");

  if (!state || !savedState || !verifier || !code ||
      state.length !== savedState.length) {
    return reply("Invalid OAuth request", 400);
  }

  let diff = 0;
  for (let i = 0; i < state.length; i++) {
    diff |= state.charCodeAt(i) ^ savedState.charCodeAt(i);
  }
  if (diff !== 0) {
    return reply("OAuth state mismatch", 400);
  }

  try {
    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: ORIGIN + "/api/auth/google/callback",
          grant_type: "authorization_code",
          code_verifier: verifier
        })
      }
    );

    if (!tokenResponse.ok) {
      return reply("Google token exchange failed", 401);
    }

    const tokenData = await tokenResponse.json();
    if (typeof tokenData.id_token !== "string") {
      return reply("Missing Google identity token", 401);
    }

    const claims = await verifyGoogleIdToken(
      tokenData.id_token,
      env.GOOGLE_CLIENT_ID
    );

    if (
      claims.email.toLowerCase() !==
      env.OFFICE_ALLOWED_EMAIL.toLowerCase()
    ) {
      return reply("Account not permitted", 403);
    }

    
    if (!env.OZON_FINANCE_DB) {
      return reply("Database unavailable", 503);
    }

    const owner = await env.OZON_FINANCE_DB.prepare(
      "SELECT google_sub FROM office_authorized_users WHERE role = 'owner' LIMIT 1"
    ).first();

    
    if (owner) {
      if (owner.google_sub !== claims.sub) {
        return reply("Account not permitted", 403);
      }

      if (!env.OFFICE_SESSION_SECRET) {
        return reply("Session configuration unavailable", 503);
      }

      const sessionCookie = await createSession(
        claims.sub,
        env.OFFICE_SESSION_SECRET
      );

      return reply(
        "Owner session established.",
        200,
        sessionCookie
      );
    }


    await env.OZON_FINANCE_DB.prepare(`
      INSERT INTO office_pending_users (google_sub, email)
      VALUES (?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email
    `).bind(
      claims.sub,
      claims.email
    ).run();

    return reply(
      "Google identity verified. Owner approval pending.",
      200
    );

  } catch {
    return reply("Google identity verification failed", 401);
  }
}
