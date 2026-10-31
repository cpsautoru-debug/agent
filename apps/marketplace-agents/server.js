
import http from "node:http";
import { checkOzonConnection } from "./ozon.js";
import { checkFboOrders } from "./ozon-orders.mjs";

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
