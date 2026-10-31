
import { checkOzonConnection } from "./ozon.js";

try {
  const result = await checkOzonConnection();

  console.log(JSON.stringify({
    check: "ozon_connection",
    connected: result.connected,
    httpStatus: result.httpStatus
  }));

  if (!result.connected) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    check: "ozon_connection",
    connected: false,
    error: error.name === "TimeoutError"
      ? "Request timeout"
      : "Connection check failed"
  }));

  process.exitCode = 1;
}
