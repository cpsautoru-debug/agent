import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = "functions/api/ozon/october-backfill.js";
const source = readFileSync(path, "utf8");

const originalImport =
  'import { verifySession } from "../auth/session.js";';

assert.ok(source.includes(originalImport));

const testSource = source.replace(
  originalImport,
  'const verifySession = async request => request.headers.get("X-Test-Sub");'
);

const moduleUrl = "data:text/javascript;base64," +
  Buffer.from(testSource).toString("base64");

const { onRequestPost } = await import(moduleUrl);

function makeEnv({ owner = true, service = true } = {}) {
  const calls = [];

  return {
    calls,
    OFFICE_SESSION_SECRET: "test-secret",
    OFFICE_ALLOWED_EMAIL: "owner@example.test",

    OZON_FINANCE_DB: {
      prepare(sql) {
        assert.match(sql, /office_authorized_users/);
        return {
          bind() {
            return {
              async first() {
                return owner ? { allowed: 1 } : null;
              }
            };
          }
        };
      }
    },

    OZON_FINANCE_SYNC: service ? {
      async prepareOctoberBackfill(jobId, count) {
        calls.push(["prepare", jobId, count]);
        return {
          status: "prepared",
          nextDate: "2026-10-01"
        };
      },

      async runBackfillBatch(jobId) {
        calls.push(["run", jobId]);
        return {
          status: "paused",
          nextDate: "2026-10-02",
          completedDates: 1,
          recordCount: 5
        };
      }
    } : null
  };
}

function makeRequest(action, {
  sub = "test-owner",
  origin = "https://office.test"
} = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Origin": origin,
    "Sec-Fetch-Site": "same-origin"
  };

  if (sub) headers["X-Test-Sub"] = sub;

  return new Request(
    "https://office.test/api/ozon/october-backfill",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ action })
    }
  );
}

async function call(action, options = {}, envOptions = {}) {
  const env = makeEnv(envOptions);
  const response = await onRequestPost({
    request: makeRequest(action, options),
    env
  });
  return {
    status: response.status,
    body: await response.json(),
    calls: env.calls
  };
}

test("No session returns 401", async () => {
  const r = await call("prepare", { sub: null });
  assert.equal(r.status, 401);
  assert.equal(r.calls.length, 0);
});

test("Non-owner returns 403", async () => {
  const r = await call("prepare", {}, { owner: false });
  assert.equal(r.status, 403);
  assert.equal(r.calls.length, 0);
});

test("Foreign origin returns 403", async () => {
  const r = await call("run", {
    origin: "https://evil.test"
  });
  assert.equal(r.status, 403);
  assert.equal(r.calls.length, 0);
});

test("Invalid action returns 400", async () => {
  const r = await call("delete");
  assert.equal(r.status, 400);
  assert.equal(r.calls.length, 0);
});

test("Missing Worker returns 503", async () => {
  const r = await call("prepare", {}, { service: false });
  assert.equal(r.status, 503);
});

test("Prepare uses fixed job and one day", async () => {
  const r = await call("prepare");
  assert.equal(r.status, 200);
  assert.deepEqual(r.calls, [
    ["prepare", "ozon-oct-2026-manual-1", 1]
  ]);
  assert.equal(r.body.nextDate, "2026-10-01");
});

test("Run calls only the fixed backfill job", async () => {
  const r = await call("run");
  assert.equal(r.status, 200);
  assert.deepEqual(r.calls, [
    ["run", "ozon-oct-2026-manual-1"]
  ]);
  assert.equal(r.body.nextDate, "2026-10-02");
});
