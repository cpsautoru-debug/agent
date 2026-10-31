
import { clearSession, verifySession } from "./session.js";

const ORIGIN = "https://autosklad63-office-staging.pages.dev";

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");

  if (origin !== ORIGIN) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": clearSession()
  });

  return new Response(
    JSON.stringify({ authenticated: false, loggedOut: true }),
    { status: 200, headers }
  );
}
