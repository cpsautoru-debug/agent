import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionSource = await readFile(
  new URL("../auth/session.js", import.meta.url),
  "utf8"
);
const sessionUrl = `data:text/javascript;base64,${Buffer
  .from(sessionSource)
  .toString("base64")}`;
const source = await readFile(
  new URL("./manual-sync.js", import.meta.url),
  "utf8"
);
const moduleSource = source.replace(
  'import { verifySession } from "../auth/session.js";',
  `const { verifySession } = await import("${sessionUrl}");`
);
const { onRequestGet, onRequestPost } = await import(
  `data:text/javascript;base64,${Buffer
    .from(moduleSource)
    .toString("base64")}`
);

async function ownerCookie() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: "local-owner",
    iat: now,
    exp: now + 8 * 60 * 60
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("local-session-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  )).toString("base64url");
  return `__Host-office_session=${payload}.${signature}`;
}

function environment({ owner = true, service } = {}) {
  return {
    OFFICE_SESSION_SECRET: "local-session-secret",
    OFFICE_ALLOWED_EMAIL: "owner@example.test",
    OZON_FINANCE_DB: {
      prepare(sql) {
        assert.match(sql, /office_authorized_users/);
        return {
          bind: (...values) => ({
            first: async () => {
              assert.deepEqual(values, [
                "local-owner",
                "owner@example.test"
              ]);
              return owner ? { allowed: 1 } : null;
            }
          })
        };
      }
    },
    OZON_FINANCE_SYNC: service
  };
}

function postRequest({
  cookie,
  origin = "https://office.test",
  fetchSite = "same-origin",
  body = "{}",
  contentType = "application/json"
} = {}) {
  const headers = {
    Origin: origin,
    "Content-Type": contentType,
    "Sec-Fetch-Site": fetchSite
  };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://office.test/api/ozon/manual-sync", {
    method: "POST",
    headers,
    body
  });
}

test("manual start requires a valid Google session and owner role", async () => {
  let calls = 0;
  const service = {
    startOneShotSync: async () => {
      calls++;
      return { status: "running" };
    },
    getOneShotSyncResult: async () => ({})
  };

  const anonymous = await onRequestPost({
    request: postRequest(),
    env: environment({ service })
  });
  assert.equal(anonymous.status, 401);

  const forbidden = await onRequestPost({
    request: postRequest({ cookie: await ownerCookie() }),
    env: environment({ owner: false, service })
  });
  assert.equal(forbidden.status, 403);
  assert.equal(calls, 0);
});

test("manual start enforces same-origin JSON CSRF protections", async () => {
  let calls = 0;
  const service = {
    startOneShotSync: async () => {
      calls++;
      return { status: "running" };
    },
    getOneShotSyncResult: async () => ({})
  };
  const cookie = await ownerCookie();

  const wrongOrigin = await onRequestPost({
    request: postRequest({ cookie, origin: "https://attacker.test" }),
    env: environment({ service })
  });
  const crossSite = await onRequestPost({
    request: postRequest({ cookie, fetchSite: "cross-site" }),
    env: environment({ service })
  });
  const nonJson = await onRequestPost({
    request: postRequest({ cookie, contentType: "text/plain" }),
    env: environment({ service })
  });
  const commandPayload = await onRequestPost({
    request: postRequest({ cookie, body: '{"date":"2026-10-28"}' }),
    env: environment({ service })
  });

  assert.equal(wrongOrigin.status, 403);
  assert.equal(crossSite.status, 403);
  assert.equal(nonJson.status, 415);
  assert.equal(commandPayload.status, 400);
  assert.equal(calls, 0);
});

test("owner start waits for the fixed one-shot RPC result", async () => {
  const calls = [];
  const service = {
    startOneShotSync: async (...args) => {
      calls.push(args);
      return {
        status: "partial",
        date: "2026-10-28",
        maxPages: 2,
        pageCount: 2,
        recordCount: 3,
        retryCount: 1,
        typesSynced: true,
        errorCode: "page_limit_reached",
        privateValue: "must-not-be-returned"
      };
    },
    getOneShotSyncResult: async () => ({})
  };

  const response = await onRequestPost({
    request: postRequest({ cookie: await ownerCookie() }),
    env: environment({ service })
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[]]);
  assert.deepEqual(body, {
    status: "partial",
    date: "2026-10-28",
    maxPages: 2,
    pageCount: 2,
    recordCount: 3,
    retryCount: 1,
    typesSynced: true,
    errorCode: "page_limit_reached"
  });
});

test("one-shot rejection is exposed as conflict without retrying", async () => {
  let calls = 0;
  const service = {
    startOneShotSync: async () => {
      calls++;
      return {
        status: "rejected",
        errorCode: "one_shot_gate_not_armed_or_already_claimed"
      };
    },
    getOneShotSyncResult: async () => ({})
  };
  const cookie = await ownerCookie();
  const first = await onRequestPost({
    request: postRequest({ cookie }),
    env: environment({ service })
  });
  const second = await onRequestPost({
    request: postRequest({ cookie }),
    env: environment({ service })
  });

  assert.equal(first.status, 409);
  assert.equal(second.status, 409);
  assert.equal(calls, 2);
  assert.deepEqual(await second.json(), {
    status: "not_started",
    errorCode: "one_shot_gate_not_armed_or_already_claimed"
  });
});

test("status read requires owner and allowlists safe result fields", async () => {
  let reads = 0;
  const service = {
    startOneShotSync: async () => ({ status: "rejected" }),
    getOneShotSyncResult: async () => {
      reads++;
      return {
        date: "2026-10-28",
        maxPages: 2,
        gateStatus: "claimed",
        claimed: true,
        status: "partial",
        run: {
          status: "partial",
          pageCount: 2,
          recordCount: 3,
          retryCount: 1,
          typesSynced: false,
          errorCode: "page_limit_reached",
          startedAt: "2026-10-28T00:00:00Z",
          finishedAt: "2026-10-28T00:01:00Z",
          secret: "not-allowed"
        },
        state: null,
        accruals: {
          count: 3,
          uniqueCount: 3,
          duplicateCount: 0,
          totalKopecks: 12345
        },
        currency: "RUB",
        reconciled: false,
        claimToken: "not-allowed"
      };
    }
  };

  const unauthorized = await onRequestGet({
    request: new Request("https://office.test/api/ozon/manual-sync"),
    env: environment({ service })
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(reads, 0);

  const response = await onRequestGet({
    request: new Request("https://office.test/api/ozon/manual-sync", {
      headers: { Cookie: await ownerCookie() }
    }),
    env: environment({ service })
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "partial");
  assert.equal(body.accruals.totalKopecks, 12345);
  assert.equal(body.run.secret, undefined);
  assert.equal(body.claimToken, undefined);
  assert.equal(reads, 1);
});

test("Cloudflare RPC failures return a safe service error", async () => {
  const service = {
    startOneShotSync: async () => {
      throw new Error("private binding details");
    },
    getOneShotSyncResult: async () => {
      throw new Error("private D1 details");
    }
  };
  const cookie = await ownerCookie();
  const post = await onRequestPost({
    request: postRequest({ cookie }),
    env: environment({ service })
  });
  const get = await onRequestGet({
    request: new Request("https://office.test/api/ozon/manual-sync", {
      headers: { Cookie: cookie }
    }),
    env: environment({ service })
  });

  assert.equal(post.status, 503);
  assert.deepEqual(await post.json(), { error: "Sync start unavailable" });
  assert.equal(get.status, 503);
  assert.deepEqual(await get.json(), { error: "Sync status unavailable" });
});

test("Ozon timeout is reported as failed, never as a successful start", async () => {
  const service = {
    startOneShotSync: async () => ({
      status: "failed",
      date: "2026-10-28",
      maxPages: 2,
      pageCount: 0,
      recordCount: 0,
      retryCount: 3,
      typesSynced: false,
      errorCode: "ozon_timeout"
    }),
    getOneShotSyncResult: async () => ({})
  };
  const response = await onRequestPost({
    request: postRequest({ cookie: await ownerCookie() }),
    env: environment({ service })
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.status, "failed");
  assert.equal(body.errorCode, "ozon_timeout");
});
