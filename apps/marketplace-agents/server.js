
import http from "node:http";
import { checkOzonConnection } from "./ozon.js";
import { checkFboOrders } from "./ozon-orders.mjs";
import { checkFbsOrders } from "./ozon-fbs.mjs";
import { checkOzonFinance } from "./ozon-finance.mjs";
import { checkFinanceTypes } from "./ozon-finance-types.mjs";
import { inspectFinanceCategories } from "./ozon-finance-classifier.mjs";
import { inspectFinanceStructure } from "./ozon-finance-inspect.mjs";
import { buildOzonFinanceReport } from "./ozon-finance-report.mjs";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 10000);

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const pathname = new URL(req.url, "http://localhost").pathname;

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      service: "autosklad63-marketplaces-staging"
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, HOST, () => {
  console.log("Marketplace staging server listening");
});

if (process.env.OZON_CONNECTION_CHECK === "true") {
  checkOzonConnection()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_connection",
        connected: result.connected,
        httpStatus: result.httpStatus
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_connection",
        connected: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "Connection check failed"
      }));
    });
}


if (process.env.OZON_ORDERS_CHECK === "true") {
  checkFboOrders()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_fbo_orders",
        connected: result.connected,
        httpStatus: result.httpStatus,
        pages: result.pages,
        total: result.total,
        complete: result.complete,
        statuses: result.statuses ?? {}
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_fbo_orders",
        connected: false,
        complete: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "Order check failed"
      }));
    });
}

if (process.env.OZON_FBS_CHECK === "true") {
  checkFbsOrders()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_fbs_orders",
        connected: result.connected,
        httpStatus: result.httpStatus,
        pages: result.pages,
        total: result.total,
        complete: result.complete,
        statuses: result.statuses ?? {}
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_fbs_orders",
        connected: false,
        complete: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "FBS check failed"
      }));
    });
}

if (process.env.OZON_FINANCE_CHECK === "true") {
  checkOzonFinance()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_finance",
        connected: result.connected,
        httpStatus: result.httpStatus,
        date: result.date,
        pages: result.pages,
        records: result.records,
        complete: result.complete
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_finance",
        connected: false,
        complete: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "Finance check failed"
      }));
    });
}

if (process.env.OZON_FINANCE_TYPES_CHECK === "true") {
  checkFinanceTypes()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_finance_types",
        connected: result.connected,
        httpStatus: result.httpStatus,
        totalTypes: result.totalTypes,
        complete: result.complete
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_finance_types",
        connected: false,
        complete: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "Finance types check failed"
      }));
    });
}

if (process.env.OZON_CLASSIFIER_CHECK === "true") {
  inspectFinanceCategories()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_classifier",
        connected: result.connected,
        complete: result.complete,
        totalTypes: result.totalTypes,
        unclassified: result.unclassified,
        types: (result.categories?.unclassified ?? [])
          .map(({ id, name }) => ({ id, name }))
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_classifier",
        connected: false,
        error: "Classifier check failed"
      }));
    });
}

if (process.env.OZON_FINANCE_INSPECT === "true") {
  inspectFinanceStructure()
    .then((result) => {
      console.log(JSON.stringify({
        check: result.check ?? "ozon_finance_structure",
        httpStatus: result.httpStatus,
        date: result.date,
        inspectedRecords: result.inspectedRecords,
        complete: result.complete,
        fieldPaths: result.fieldPaths ?? [],
        typeIds: result.typeIds ?? []
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_finance_structure",
        complete: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "Finance inspection failed"
      }));
    });
}

if (process.env.OZON_FINANCE_REPORT === "true") {
  buildOzonFinanceReport()
    .then((result) => {
      console.log(JSON.stringify({
        check: "ozon_finance_report",
        date: result.date,
        httpStatus: result.httpStatus,
        pages: result.pages,
        records: result.records,
        complete: result.complete,
        currency: result.currency,
        controlTotal: result.controlTotal,
        categories: result.categories ?? {}
      }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        check: "ozon_finance_report",
        complete: false,
        error: error.name === "TimeoutError"
          ? "Request timeout"
          : "Finance report failed"
      }));
    });
}
