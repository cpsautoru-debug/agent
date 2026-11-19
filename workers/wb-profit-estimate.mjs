// Local management estimate only. All monetary inputs/outputs are integer kopecks.
// The WB payout is already net of WB deductions recorded in the weekly report;
// do not deduct those expenses again here.
const inputFields = new Set([
  "reportId", "payoutKop", "cogsKop", "taxBaseKop", "returnedCogsKop"
]);
const moneyFields = ["payoutKop", "cogsKop", "taxBaseKop", "returnedCogsKop"];
const limit = BigInt(Number.MAX_SAFE_INTEGER);

function safeKopecks(value, label) {
  if (value < -limit || value > limit) throw new Error("amount_overflow: " + label);
  return Number(value);
}

export function buildWbProfitEstimate(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid_input");
  }
  if (Object.keys(input).some(key => !inputFields.has(key))) {
    throw new Error("unsupported_field");
  }
  if (typeof input.reportId !== "string" || !/^[0-9]{1,20}$/.test(input.reportId)) {
    throw new Error("invalid_report_id");
  }
  for (const field of moneyFields) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) {
      throw new Error("invalid_amount: " + field);
    }
  }
  if (input.returnedCogsKop > input.cogsKop) {
    throw new Error("invalid_return_cost");
  }

  // AУСН 8%: an explicitly assumed tax base, not an FNS assessment.
  // Integer arithmetic rounds the estimated tax to the nearest kopeck.
  const tax = (BigInt(input.taxBaseKop) * 8n + 50n) / 100n;
  const baseProfit = BigInt(input.payoutKop) - BigInt(input.cogsKop) - tax;
  const restoredProfit = baseProfit + BigInt(input.returnedCogsKop);

  return Object.freeze({
    reportId: input.reportId,
    source: "MANUAL_ESTIMATE",
    dataVerified: false,
    profitStatus: "UNVERIFIED",
    taxRatePercent: 8,
    taxBasisStatus: "ASSUMED",
    taxKop: safeKopecks(tax, "taxKop"),
    payoutKop: input.payoutKop,
    cogsKop: input.cogsKop,
    returnedCogsKop: input.returnedCogsKop,
    profitWithoutRestorationKop: safeKopecks(baseProfit, "profitWithoutRestorationKop"),
    profitWithRestorationKop: safeKopecks(restoredProfit, "profitWithRestorationKop"),
    returnState: "UNCONFIRMED",
    additionalExpensesStatus: "NOT_RECONCILED"
  });
}
