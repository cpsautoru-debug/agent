
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function onRequestGet({ request, env }) {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.OFFICE_SESSION_SECRET
  ) {
    return new Response("OAuth not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const origin = new URL(request.url).origin;

  if (origin !== "https://autosklad63-office-staging.pages.dev") {
    return new Response("Invalid origin", { status: 403 });
  }

  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  const challenge = base64url(new Uint8Array(digest));

  const redirectUri = origin + "/api/auth/google/callback";

  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  google.searchParams.set("redirect_uri", redirectUri);
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email profile");
  google.searchParams.set("state", state);
  google.searchParams.set("code_challenge", challenge);
  google.searchParams.set("code_challenge_method", "S256");
  google.searchParams.set("prompt", "select_account");

  const headers = new Headers({
    "Location": google.toString(),
    "Cache-Control": "no-store"
  });

  headers.append(
    "Set-Cookie",
    `oauth_state=${state}; Max-Age=600; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax`
  );

  headers.append(
    "Set-Cookie",
    `oauth_verifier=${verifier}; Max-Age=600; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax`
  );

  return new Response(null, {
    status: 302,
    headers
  });
}
