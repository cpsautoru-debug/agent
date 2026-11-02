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
  new URL("./reconciliation.js", import.meta.url),
  "utf8"
);
const moduleSource = source.replace(
  'import { verifySession } from "../auth/session.js";',
  `const { verifySession } = await import("${sessionUrl}");`
);
const { onRequestPost } = await import(
  `data:text/javascript;base64,${Buffer
    .from(moduleSource)
    .toString("base64")}`
);

const manifest = {
  operationDate: "2026-10-28",
  report: {
    name: "test-report.xlsx",
    sha256: "a".repeat(64),
    detailRows: 1
  },
  expectedTotalKopecks: 100,
  expectedPositiveKopecks: 100,
  expectedNegativeKopecks: 0,
  accruals: [{
    accrualId: "101",
    operationDate: "2026-10-28",
    unitNumber: "shipment-1",
    category: "POSTING",
    totalKopecks: 100
  }],
  groups: [{
    unitNumber: "shipment-1",
    detailRows: 1,
    totalKopecks: 100
  }]
};

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

function request(body, {
  cookie,
  origin = "https://office.test",
  fetchSite = "same-origin",
  contentType = "application/json"
} = {}) {
  const headers = {
    Origin: origin,
    "Sec-Fetch-Site": fetchSite,
    "Content-Type": contentType
  };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://office.test/api/ozon/reconciliation", {
    method: "POST",
    headers,
    body
  });
}

function previewResult() {
  return {
    status: "ready_to_confirm",
    auditId: `ozon:2026-10-28:${"A".repeat(64)}`,
    operationDate: "2026-10-28",
    sourceReport: "test-report.xlsx",
    sourceSha256: "A".repeat(64),
    recordCount: 1,
    groupCount: 1,
    totalKopecks: 100,
    netStatus: "verified",
    detailStatus: "unverified",
    detailReason: "ozon_api_component_mapping_incomplete",
    previewToken: "preview-token"
  };
}

function confirmedResult() {
  return {
    status: "net_verified_details_unverified",
    auditId: `ozon:2026-10-28:${"A".repeat(64)}`,
    recordCount: 1,
    totalKopecks: 100,
    netStatus: "verified",
    detailStatus: "unverified",
    detailReason: "ozon_api_component_mapping_incomplete"
  };
}

test("owner preview returns only safe result fields and forwards manifest", async () => {
  let receivedManifest;
  const service = {
    async previewReconciliation(value) {
      receivedManifest = value;
      return { ...previewResult(), privateField: "not returned" };
    }
  };
  const response = await onRequestPost({
    request: request(JSON.stringify({ action: "preview", manifest }), {
      cookie: await ownerCookie()
    }),
    env: environment({ service })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(receivedManifest, manifest);
  assert.deepEqual(await response.json(), previewResult());
});

test("owner confirm forwards the unchanged manifest and preview token", async () => {
  let received;
  const service = {
    async confirmReconciliation(value, previewToken) {
      received = { value, previewToken };
      return { ...confirmedResult(), privateField: "not returned" };
    }
  };
  const response = await onRequestPost({
    request: request(JSON.stringify({
      action: "confirm",
      manifest,
      previewToken: "signed-preview-token"
    }), { cookie: await ownerCookie() }),
    env: environment({ service })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    value: manifest,
    previewToken: "signed-preview-token"
  });
  assert.deepEqual(await response.json(), confirmedResult());
});

test("reconciliation requires owner session and rejects cross-origin requests", async () => {
  let calls = 0;
  const service = {
    async previewReconciliation() {
      calls++;
      return previewResult();
    }
  };

  const anonymous = await onRequestPost({
    request: request(JSON.stringify({ action: "preview", manifest })),
    env: environment({ service })
  });
  const forbidden = await onRequestPost({
    request: request(JSON.stringify({ action: "preview", manifest }), {
      cookie: await ownerCookie()
    }),
    env: environment({ owner: false, service })
  });
  const crossOrigin = await onRequestPost({
    request: request(JSON.stringify({ action: "preview", manifest }), {
      cookie: await ownerCookie(),
      origin: "https://attacker.test"
    }),
    env: environment({ service })
  });

  assert.equal(anonymous.status, 401);
  assert.equal(forbidden.status, 403);
  assert.equal(crossOrigin.status, 403);
  assert.equal(calls, 0);
});

test("reconciliation enforces JSON and request body size limits", async () => {
  const cookie = await ownerCookie();
  const nonJson = await onRequestPost({
    request: request("{}", { cookie, contentType: "text/plain" }),
    env: environment({ service: {} })
  });
  const oversized = await onRequestPost({
    request: request(JSON.stringify({
      action: "preview",
      manifest,
      padding: "x".repeat(256 * 1024)
    }), { cookie }),
    env: environment({ service: {} })
  });

  assert.equal(nonJson.status, 415);
  assert.equal(oversized.status, 413);
});

test("reconciliation exposes conflicts and hides binding errors", async () => {
  const cookie = await ownerCookie();
  const conflict = await onRequestPost({
    request: request(JSON.stringify({
      action: "confirm",
      manifest,
      previewToken: "token"
    }), { cookie }),
    env: environment({
      service: {
        async confirmReconciliation() {
          throw Object.assign(
            new Error("reconciliation_sync_in_progress"),
            { code: "reconciliation_sync_in_progress" }
          );
        }
      }
    })
  });
  const unavailable = await onRequestPost({
    request: request(JSON.stringify({ action: "preview", manifest }), {
      cookie
    }),
    env: environment({
      service: {
        async previewReconciliation() {
          throw new Error("private binding detail");
        }
      }
    })
  });

  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: "Reconciliation unavailable",
    errorCode: "reconciliation_sync_in_progress"
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: "Reconciliation unavailable",
    errorCode: null
  });
});
