
import { buildOzonMonthlyReport }
  from "./ozon-finance-report.mjs";

if (process.env.OZON_READ_ONLY !== "true") {
  throw new Error("Read-only mode required");
}

if (process.env.OZON_MONTHLY_RUN !== "true") {
  throw new Error("Manual authorization required");
}

const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, 180000);

try {
  const report = await Promise.race([
    buildOzonMonthlyReport(2026, 10),
    new Promise((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error("Monthly timeout")),
        { once: true }
      );
    })
  ]);

  console.log(JSON.stringify({
    check: report.check,
    period: report.period,
    complete: report.complete,
    reconciled: report.reconciled ?? false,
    final: report.final ?? false,
    processedDays: report.processedDays,
    records: report.records,
    currency: report.currency,
    controlTotal: report.controlTotal,
    categories: report.categories ?? {}
  }));

  if (!report.complete) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    check: "ozon_monthly_finance",
    complete: false,
    error: "Monthly report failed or timed out"
  }));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
