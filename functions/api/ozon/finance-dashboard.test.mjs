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

async function loadRoute(name) {
  const source = await readFile(
    new URL(`./${name}.js`, import.meta.url),
    "utf8"
  );
  const moduleSource = source.replace(
    'import { verifySession } from "../auth/session.js";',
    `const { verifySession } = await import("${sessionUrl}");`
  );
  return import(
    `data:text/javascript;base64,${Buffer
      .from(moduleSource)
      .toString("base64")}`
  );
}

const statusRoute = await loadRoute("sync-status");
const syncRoute = await loadRoute("sync");

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
  const financialReads = [];
  const env = {
    OFFICE_SESSION_SECRET: "local-session-secret",
    OFFICE_ALLOWED_EMAIL: "owner@example.test",
    OZON_FINANCE_DB: {
      prepare(sql) {
        assert.match(sql, /office_authorized_users/i);
        assert.doesNotMatch(sql, /ozon_api_accruals/i);
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
  return { env, financialReads };
}

function postRequest({
  cookie,
  origin = "https://office.test",
  fetchSite = "same-origin",
  body = "{}"
} = {}) {
  const headers = {
    Origin: origin,
    "Content-Type": "application/json",
    "Sec-Fetch-Site": fetchSite
  };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://office.test/api/ozon/sync", {
    method: "POST",
    headers,
    body
  });
}

test("dashboard endpoint requires owner and reads through the Worker binding", async () => {
  let calls = 0;
  const { env } = environment({
    service: {
      async getFinanceDashboard(start, end) {
        calls++;
        assert.equal(start, "2026-10-28");
        assert.equal(end, "2026-10-28");
        return {
          source: "ozon_seller_api",
          currency: "RUB",
          daily: [],
          categories: [],
          operations: [],
          totals: {},
          coverage: {}
        };
      }
    }
  });

  const denied = await statusRoute.onRequestGet({
    request: new Request("https://office.test/api/ozon/sync-status"),
    env
  });
  assert.equal(denied.status, 401);
  assert.equal(calls, 0);

  const response = await statusRoute.onRequestGet({
    request: new Request(
      "https://office.test/api/ozon/sync-status?start=2026-10-28&end=2026-10-28",
      { headers: { Cookie: await ownerCookie() } }
    ),
    env
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("dashboard rejects invalid or unpaired period bounds", async () => {
  const { env } = environment({
    service: {
      async getFinanceDashboard() {
        throw new Error("Must not call Worker");
      }
    }
  });
  const response = await statusRoute.onRequestGet({
    request: new Request(
      "https://office.test/api/ozon/sync-status?start=2026-10-01",
      { headers: { Cookie: await ownerCookie() } }
    ),
    env
  });
  assert.equal(response.status, 400);
});

test("manual recent sync is owner-only and same-origin protected", async () => {
  let starts = 0;
  const { env } = environment({
    service: {
      async startRecentSync() {
        starts++;
        return {
          status: "started",
          runId: "123e4567-e89b-42d3-a456-426614174000",
          periodStart: "2026-10-26",
          periodEnd: "2026-10-28"
        };
      }
    }
  });
  const cookie = await ownerCookie();

  const unauthenticated = await syncRoute.onRequestPost({
    request: postRequest(),
    env
  });
  assert.equal(unauthenticated.status, 401);

  const crossOrigin = await syncRoute.onRequestPost({
    request: postRequest({ cookie, origin: "https://attacker.test" }),
    env
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(starts, 0);

  const started = await syncRoute.onRequestPost({
    request: postRequest({ cookie }),
    env
  });
  assert.equal(started.status, 202);
  assert.equal(starts, 1);
  assert.deepEqual(await started.json(), {
    status: "started",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    periodStart: "2026-10-26",
    periodEnd: "2026-10-28"
  });
});

test("manual sync rejects caller-supplied dates and unsafe service results", async () => {
  const { env } = environment({
    service: {
      async startRecentSync() {
        return {
          status: "started",
          runId: "123e4567-e89b-42d3-a456-426614174000",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31"
        };
      }
    }
  });
  const cookie = await ownerCookie();
  const response = await syncRoute.onRequestPost({
    request: postRequest({
      cookie,
      body: JSON.stringify({ start: "2026-10-01", end: "2026-10-31" })
    }),
    env
  });
  assert.equal(response.status, 400);
});

test("manual sync reports an active run as a conflict without starting another", async () => {
  let starts = 0;
  const { env } = environment({
    service: {
      async startRecentSync() {
        starts++;
        return {
          status: "rejected",
          errorCode: "sync_already_running"
        };
      }
    }
  });
  const response = await syncRoute.onRequestPost({
    request: postRequest({ cookie: await ownerCookie() }),
    env
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    status: "rejected",
    errorCode: "sync_already_running"
  });
  assert.equal(starts, 1);
});
