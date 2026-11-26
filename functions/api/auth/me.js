
import { verifySession } from "./session.js";

export async function onRequestGet({ request, env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };

  if (!env.OFFICE_SESSION_SECRET || !env.OZON_FINANCE_DB) {
    return new Response(
      JSON.stringify({ authenticated: false }),
      { status: 503, headers }
    );
  }

  const googleSub = await verifySession(
    request,
    env.OFFICE_SESSION_SECRET
  );

  if (!googleSub) {
    return new Response(
      JSON.stringify({ authenticated: false }),
      { status: 401, headers }
    );
  }

  let owner;
  try {
    owner = await env.OZON_FINANCE_DB.prepare(
      `SELECT role
       FROM office_authorized_users
       WHERE google_sub = ?
         AND email = ?
         AND role = 'owner'
       LIMIT 1`
    ).bind(googleSub, env.OFFICE_ALLOWED_EMAIL).first();
  } catch (error) {
    const detail=String(error?.cause?.message||'')+' '+String(error?.message||'');
    const quota=/exceeded.{0,100}(?:daily|rows read)|(?:daily|rows read).{0,100}(?:limit|quota).{0,40}exceeded/i.test(detail);
    return new Response(
      JSON.stringify({ authenticated: false, code: quota?"owner_auth_d1_quota":"owner_auth_storage_unavailable" }),
      { status: 503, headers }
    );
  }

  if (!owner) {
    return new Response(
      JSON.stringify({ authenticated: false }),
      { status: 403, headers }
    );
  }

  return new Response(
    JSON.stringify({
      authenticated: true,
      role: "owner"
    }),
    { status: 200, headers }
  );
}
