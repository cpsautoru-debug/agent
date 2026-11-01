import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionSource = await readFile(
  new URL("../auth/session.js", import.meta.url),
  "utf8"
);
const sessionModuleUrl = `data:text/javascript;base64,${Buffer
  .from(sessionSource)
  .toString("base64")}`;
const connectSource = await readFile(
  new URL("./connect.js", import.meta.url),
  "utf8"
);
const connectModuleSource = connectSource.replace(
  'import { verifySession } from "../auth/session.js";',
  `const { verifySession } = await import("${sessionModuleUrl}");`
);
const { onRequestGet } = await import(
  `data:text/javascript;base64,${Buffer
    .from(connectModuleSource)
    .toString("base64")}`
);

async function sessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: "local-owner",
    iat: now,
    exp: now + 8 * 60 * 60
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("local-test-secret"),
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

async function callEndpoint({
  fetchImpl = async () => new Response(JSON.stringify({
    result: { items: [] }
  })),
  includeSession = true,
  owner = true,
  envOverrides = {}
} = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    const env = {
      OFFICE_SESSION_SECRET: "local-test-secret",
      OFFICE_ALLOWED_EMAIL: "owner@example.test",
      OZON_FINANCE_DB: {
        prepare(query) {
          assert.match(query, /role = 'owner'/);
          return {
            bind(...params) {
              assert.deepEqual(params, [
                "local-owner",
                "owner@example.test"
              ]);
              return {
                first: async () => owner ? { allowed: 1 } : null
              };
            }
          };
        }
      },
      OZON_CLIENT_ID: "local-client-id",
      OZON_API_KEY: "local-api-key",
      ...envOverrides
    };
    const requestHeaders = includeSession
      ? { Cookie: await sessionCookie() }
      : {};
    const response = await onRequestGet({
      request: new Request(
        "https://office.example/api/ozon/connect",
        { headers: requestHeaders }
      ),
      env
    });

    return {
      response,
      body: await response.json()
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("accepts the documented nested product-list response", async () => {
  const result = await callEndpoint({
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api-seller.ozon.ru/v3/product/list");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Client-Id"], "local-client-id");
      assert.equal(options.headers["Api-Key"], "local-api-key");
      assert.deepEqual(JSON.parse(options.body), {
        filter: { visibility: "ALL" },
        last_id: "",
        limit: 1
      });
      return new Response(JSON.stringify({
        result: { items: [] }
      }));
    }
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, {
    connected: true,
    status: "connected",
    errorCode: null,
    stage: "complete",
    ozonHttpStatus: 200
  });
  assert.equal(JSON.stringify(result.body).includes("local-api-key"), false);
});

test("preserves Google-session and owner authorization checks", async () => {
  let fetchCalls = 0;
  const missingSession = await callEndpoint({
    includeSession: false,
    fetchImpl: async () => {
      fetchCalls++;
      return new Response();
    }
  });
  const notOwner = await callEndpoint({
    owner: false,
    fetchImpl: async () => {
      fetchCalls++;
      return new Response();
    }
  });

  assert.equal(missingSession.response.status, 401);
  assert.equal(missingSession.body.errorCode, "google_session_missing_or_invalid");
  assert.equal(notOwner.response.status, 403);
  assert.equal(notOwner.body.errorCode, "owner_access_required");
  assert.equal(fetchCalls, 0);
});

test("reports missing Ozon configuration without calling Ozon", async () => {
  let fetchCalls = 0;
  const result = await callEndpoint({
    envOverrides: { OZON_API_KEY: "" },
    fetchImpl: async () => {
      fetchCalls++;
      return new Response();
    }
  });

  assert.equal(result.response.status, 503);
  assert.deepEqual(result.body, {
    connected: false,
    status: "unavailable",
    errorCode: "ozon_api_key_missing",
    stage: "configuration",
    ozonHttpStatus: null
  });
  assert.equal(fetchCalls, 0);
});

test("distinguishes Ozon HTTP authorization failures safely", async () => {
  for (const [status, errorCode] of [
    [401, "ozon_unauthorized"],
    [403, "ozon_forbidden"]
  ]) {
    const result = await callEndpoint({
      fetchImpl: async () => new Response(
        "sensitive upstream response",
        { status }
      )
    });

    assert.equal(result.response.status, 502);
    assert.equal(result.body.errorCode, errorCode);
    assert.equal(result.body.stage, "ozon_http");
    assert.equal(result.body.ozonHttpStatus, status);
    assert.equal(JSON.stringify(result.body).includes("sensitive"), false);
  }
});

test("detects invalid JSON and unexpected response shape", async () => {
  for (const body of [
    "{not-json",
    JSON.stringify({ items: [] })
  ]) {
    const result = await callEndpoint({
      fetchImpl: async () => new Response(body)
    });

    assert.equal(result.response.status, 502);
    assert.equal(result.body.errorCode, "ozon_invalid_api_response");
    assert.equal(result.body.stage, "ozon_response");
    assert.equal(result.body.ozonHttpStatus, 200);
  }
});

test("distinguishes request timeout from network errors", async () => {
  const timeoutError = new Error("local timeout");
  timeoutError.name = "TimeoutError";
  const timeout = await callEndpoint({
    fetchImpl: async () => {
      throw timeoutError;
    }
  });
  const network = await callEndpoint({
    fetchImpl: async () => {
      throw new TypeError("local network error");
    }
  });

  assert.equal(timeout.response.status, 504);
  assert.equal(timeout.body.errorCode, "ozon_request_timeout");
  assert.equal(timeout.body.stage, "ozon_request");
  assert.equal(timeout.body.ozonHttpStatus, null);
  assert.equal(network.response.status, 502);
  assert.equal(network.body.errorCode, "ozon_network_error");
  assert.equal(network.body.stage, "ozon_request");
  assert.equal(network.body.ozonHttpStatus, null);
});

test("detects timeout while reading the Ozon response", async () => {
  const timeoutError = new Error("local body timeout");
  timeoutError.name = "AbortError";
  const result = await callEndpoint({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw timeoutError;
      }
    })
  });

  assert.equal(result.response.status, 504);
  assert.equal(result.body.errorCode, "ozon_request_timeout");
  assert.equal(result.body.stage, "ozon_response");
  assert.equal(result.body.ozonHttpStatus, 200);
});
