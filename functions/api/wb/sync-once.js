import { verifySession } from '../auth/session.js';
import { runWbSync } from '../../../workers/wb-finance-auto-sync.js';

const ORIGIN = 'https://autosklad63-office-staging.pages.dev';
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Cookie, Origin'
};
const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: HEADERS
});

// One explicitly owner-authorized Finance call in staging using existing Pages secret.
// No public scheduler or additional token copies. XLSX snapshots stay untouched.
export function createOwnerSyncHandler(sync = runWbSync) {
  return async function onRequestPost({ request, env }) {
    try {
      if (request.method !== 'POST') return json(405, { code:'method_not_allowed' });
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.search ||
        request.headers.get('Origin') !== ORIGIN ||
        request.headers.get('Content-Type') !== 'application/json' ||
        request.headers.get('X-WB-One-Shot') !== 'owner-20261120') {
        return json(403, { code:'invalid_request' });
      }
      if (!env?.OFFICE_SESSION_SECRET || !env.OFFICE_ALLOWED_EMAIL ||
          !env.OZON_FINANCE_DB || !env.WB_REPORT_SNAPSHOT_DB ||
          env.WB_REPORT_ACCOUNT_ID !== '4271851' ||
          env.WB_REPORT_SAVE_MODE !== 'test-only' ||
          typeof env.WB_API_TOKEN !== 'string' || !env.WB_API_TOKEN ||
          /\s/.test(env.WB_API_TOKEN)) {
        return json(503, { code:'staging_configuration_unavailable' });
      }
      const sub = await verifySession(request, env.OFFICE_SESSION_SECRET);
      if (!sub) return json(401, { code:'unauthorized' });
      const owner = await env.OZON_FINANCE_DB.prepare(
        "SELECT 1 AS allowed FROM office_authorized_users WHERE google_sub = ? AND email = ? AND role = 'owner' LIMIT 1"
      ).bind(sub, env.OFFICE_ALLOWED_EMAIL).first();
      if (owner?.allowed !== 1) return json(403, { code:'forbidden' });
      const declaredLength = request.headers.get('Content-Length');
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) ||
          Number(declaredLength) > 16)) return json(400, {code:'invalid_body'});
      if (await request.text() !== '{}') return json(400,{code:'invalid_body'});
      // Explicit permission for this *single* request only; Worker/Cron remain disabled.
      const result = await sync({ ...env, WB_FINANCE_AUTO_SYNC:'enabled' });
      return json(200, {
        code:'owner_requested_wb_sync_step',
        result, source:'WB_FINANCE_API',
        requestScope:'ONE_UPSTREAM_CALL_MAX',
        cronEnabled:false,
        xlsxModified:false
      });
    } catch {
      return json(503, {code:'sync_step_unavailable', cronEnabled:false});
    }
  };
}
export const onRequestPost = createOwnerSyncHandler();
