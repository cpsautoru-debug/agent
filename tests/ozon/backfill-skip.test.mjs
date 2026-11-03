import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("workers/ozon-finance-sync.js", "utf8");
const methodPos = source.indexOf("  async runBackfillBatch(jobId) {");
const start = source.indexOf("    const completedRows = await db.prepare(`", methodPos);
const end = source.indexOf("    const stateResult = await db.prepare(`", start);

assert.ok(methodPos >= 0 && start > methodPos && end > start);

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const execute = new AsyncFunction(
  "db", "SOURCE", "dates", "syncOzonFinance",
  "MAX_BACKFILL_PAGES_PER_DAY", "safeErrorCode",
  source.slice(start, end) + "\nreturn { pendingDates, result };"
);

async function simulate(dates, completedDates) {
  const calls = [];
  const db = {
    prepare(sql) {
      assert.match(sql, /SELECT sync_date FROM ozon_api_sync_state/);
      return {
        bind() {
          return {
            async all() {
              return {
                results: completedDates.map(sync_date => ({ sync_date }))
              };
            }
          };
        }
      };
    }
  };
  const output = await execute.call(
    { env: {} },
    db,
    "ozon_seller_api",
    dates,
    async (_env, args) => {
      calls.push(args.dates);
      return { status: "complete", pageCount: 1, recordCount: 5 };
    },
    12,
    () => "test_error"
  );
  return { calls, output };
}

test("Backfill skips completed October 28", async () => {
  const r = await simulate(
    ["2026-10-27", "2026-10-28", "2026-10-29"],
    ["2026-10-28"]
  );
  assert.deepEqual(r.calls, [
    ["2026-10-27", "2026-10-29"]
  ]);
});

test("Backfill does not import when every date is complete", async () => {
  const dates = ["2026-10-28", "2026-10-30", "2026-10-31"];
  const r = await simulate(dates, dates);
  assert.equal(r.calls.length, 0);
  assert.equal(r.output.result.status, "skipped");
});

test("Backfill imports dates that are not complete", async () => {
  const dates = ["2026-10-01", "2026-10-02"];
  const r = await simulate(dates, []);
  assert.deepEqual(r.calls, [dates]);
});
