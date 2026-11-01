import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(
  new URL("./ozon-finance.js", import.meta.url),
  "utf8"
);
const html = await readFile(
  new URL("./index.html", import.meta.url),
  "utf8"
);
const styles = await readFile(
  new URL("./ozon-finance.css", import.meta.url),
  "utf8"
);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.disabled = false;
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.classList = {
      add() {},
      remove() {}
    };
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  async dispatch(type, event = {}) {
    return this.listeners.get(type)?.({
      preventDefault() {},
      ...event
    });
  }

  querySelector() {
    if (!this.submitButton) {
      this.submitButton = new FakeElement(`${this.id}-submit`);
    }
    return this.submitButton;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }
}

function dashboard() {
  return {
    source: "ozon_seller_api",
    currency: "RUB",
    periodStart: "2026-10-26",
    periodEnd: "2026-10-28",
    daily: [],
    categories: [],
    operations: [],
    totals: {
      recordCount: null,
      totalKopecks: null,
      positiveKopecks: null,
      negativeKopecks: null,
      positiveCount: null,
      negativeCount: null
    },
    coverage: { days: 3, completeDays: 0, reconciledDays: 0 },
    lastSuccessfulAt: null,
    componentVerification: {
      status: "unverified",
      reason: "ozon_api_component_mapping_incomplete"
    },
    latestRun: null,
    reconciled: false,
    truncated: false
  };
}

function createOffice({
  identity = { authenticated: true, role: "owner" },
  postResponse = { status: 202, body: {
    status: "started",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    periodStart: "2026-10-26",
    periodEnd: "2026-10-28"
  } },
  statusResponse = dashboard(),
  statusHttpStatus = 200,
  holdAuth,
  holdPost
} = {}) {
  const ids = [
    "ozonTotal", "ozonTotalNote", "ozonArticlesBody",
    "ozonArticlesNote", "ozonApiSyncPeriod", "ozonApiSyncSummary",
    "ozonLastSuccessfulSync", "ozonReconciliationSummary",
    "ozonApiSyncBody", "ozonApiTotal", "ozonApiPositive",
    "ozonApiNegative", "ozonApiPositiveNote", "ozonApiNegativeNote",
    "ozonApiCoverage", "ozonApiCoverageNote", "ozonApiChart",
    "ozonCategoriesBody", "ozonOperationsBody", "ozonOperationsNote",
    "ozonPeriodForm", "ozonPeriodStart", "ozonPeriodEnd",
    "ozonRefreshButton", "ozonRefreshMessage", "ozonCostForm",
    "costSku", "costRubles", "costStatus", "costMessage",
    "ozonAuthRequired", "ozonAuthMessage", "ozonRetryAuthButton",
    "ozonSyncReadiness"
  ];
  const elements = new Map(
    ids.map(id => [id, new FakeElement(id)])
  );
  const requests = [];
  const windowListeners = new Map();
  let authStarted;
  const authStartedPromise = new Promise(resolve => {
    authStarted = resolve;
  });
  let releaseAuth;
  const authRelease = holdAuth
    ? new Promise(resolve => { releaseAuth = resolve; })
    : Promise.resolve();
  let postStarted;
  const postStartedPromise = new Promise(resolve => {
    postStarted = resolve;
  });
  let releasePost;
  const postRelease = holdPost
    ? new Promise(resolve => { releasePost = resolve; })
    : Promise.resolve();

  for (const id of ["ozonPeriodStart", "ozonPeriodEnd", "ozonRefreshButton"]) {
    elements.get(id).disabled = true;
  }
  elements.get("ozonAuthRequired").hidden = true;
  elements.get("ozonSyncReadiness").hidden = true;
  elements.get("costStatus").value = "preliminary";
  elements.get("ozonAuthRequired").loginHref = "/api/auth/google/start";

  const response = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    }
  });

  const fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/api/auth/me") {
      authStarted();
      await authRelease;
      const status = identity.authenticated ? 200 : 401;
      return response(status, identity);
    }
    if (path === "/api/ozon/report") {
      return response(200, {
        period: "2026-10",
        totalKopecks: 3237700,
        processedDays: 1,
        recordsCount: 11,
        reconciled: false,
        final: false
      });
    }
    if (path === "/api/ozon/articles") {
      return response(200, {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-29",
        articles: [],
        totalKopecks: 0,
        totalOperations: 0
      });
    }
    if (path === "/api/ozon/costs") {
      return response(200, { costs: [] });
    }
    if (path.startsWith("/api/ozon/sync-status")) {
      return response(statusHttpStatus, statusResponse);
    }
    if (path === "/api/ozon/sync" && options.method === "POST") {
      postStarted();
      await postRelease;
      return response(postResponse.status, postResponse.body);
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const document = {
    getElementById: id => elements.get(id) || null,
    querySelector: selector => selector === '[data-section="ozonFinance"]'
      ? new FakeElement("section")
      : null,
    querySelectorAll: () => [],
    createElement: tag => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement("fragment")
  };
  const window = {
    addEventListener(type, callback) {
      windowListeners.set(type, callback);
    }
  };

  runInNewContext(source, {
    document,
    window,
    location: { hash: "#ozonFinance" },
    fetch,
    Option: class {
      constructor(label, value) {
        this.textContent = label;
        this.value = value;
      }
    },
    URLSearchParams,
    Intl,
    Date,
    Number,
    Math,
    Promise,
    setTimeout: callback => {
      callback();
      return 0;
    },
    console
  });

  return {
    elements,
    requests,
    authStartedPromise,
    releaseAuth,
    postStartedPromise,
    releasePost,
    windowListeners
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test("owner authorization enables date controls and the ready refresh button", async () => {
  const office = createOffice();
  await settle();
  assert.equal(office.elements.get("ozonPeriodStart").disabled, false);
  assert.equal(office.elements.get("ozonPeriodEnd").disabled, false);
  assert.equal(office.elements.get("ozonPeriodForm").querySelector()
    .disabled, false);
  assert.equal(office.elements.get("ozonRefreshButton").disabled, false);
  assert.equal(office.elements.get("ozonAuthRequired").hidden, true);
  assert.match(
    office.elements.get("ozonSyncReadiness").textContent,
    /готов к ручному запуску/
  );
});

test("date changes fetch the selected period without starting a sync", async () => {
  const office = createOffice();
  await settle();
  office.elements.get("ozonPeriodStart").value = "2026-10-28";
  office.elements.get("ozonPeriodEnd").value = "2026-10-28";
  await office.elements.get("ozonPeriodForm").dispatch("submit");
  assert.ok(office.requests.some(request =>
    request.path ===
      "/api/ozon/sync-status?start=2026-10-28&end=2026-10-28"
  ));
  assert.equal(
    office.requests.filter(request => request.options.method === "POST").length,
    0
  );
});

test("unauthorized visitors receive an explicit Google sign-in action", async () => {
  const office = createOffice({
    identity: { authenticated: false }
  });
  await settle();
  assert.equal(office.elements.get("ozonPeriodStart").disabled, true);
  assert.equal(office.elements.get("ozonPeriodEnd").disabled, true);
  assert.equal(office.elements.get("ozonRefreshButton").disabled, true);
  assert.equal(office.elements.get("ozonAuthRequired").hidden, false);
  assert.match(
    office.elements.get("ozonAuthMessage").textContent,
    /Требуется вход владельца/
  );
  assert.equal(
    office.elements.get("ozonAuthRequired").loginHref,
    "/api/auth/google/start"
  );
  assert.match(html, /href="\/api\/auth\/google\/start"/);
  await office.elements.get("ozonRefreshButton").dispatch("click");
  assert.equal(
    office.requests.filter(request => request.options.method === "POST").length,
    0
  );
});

test("owner status confirmation precedes enabling the refresh button", async () => {
  const office = createOffice();
  await settle();
  const statusRequest = office.requests.find(request =>
    request.path.startsWith("/api/ozon/sync-status")
  );
  assert.ok(statusRequest);
  await settle();
  assert.equal(office.elements.get("ozonRefreshButton").disabled, false);
});

test("financial status errors do not disable owner period filters", async () => {
  const office = createOffice({ statusHttpStatus: 503 });
  await settle();
  assert.equal(office.elements.get("ozonPeriodStart").disabled, false);
  assert.equal(office.elements.get("ozonPeriodEnd").disabled, false);
  assert.equal(office.elements.get("ozonRefreshButton").disabled, true);
  assert.match(
    office.elements.get("ozonSyncReadiness").textContent,
    /поля периода остаются доступны/i
  );
});

test("malformed financial status never enables the refresh button", async () => {
  const office = createOffice({
    statusResponse: {
      ...dashboard(),
      coverage: {}
    }
  });
  await settle();
  assert.equal(office.elements.get("ozonPeriodStart").disabled, false);
  assert.equal(office.elements.get("ozonPeriodEnd").disabled, false);
  assert.equal(office.elements.get("ozonRefreshButton").disabled, true);
  assert.match(
    office.elements.get("ozonSyncReadiness").textContent,
    /статус финансового сервиса недоступен/i
  );
});

test("concurrent page events share one owner authorization check", async () => {
  const office = createOffice({ holdAuth: true });
  await office.authStartedPromise;
  office.windowListeners.get("hashchange")();
  office.windowListeners.get("pageshow")({ persisted: true });
  office.releaseAuth();
  await settle();
  assert.equal(
    office.requests.filter(request => request.path === "/api/auth/me").length,
    1
  );
  assert.equal(office.elements.get("ozonPeriodStart").disabled, false);
  assert.equal(office.elements.get("ozonRefreshButton").disabled, false);
});

test("rapid repeated clicks issue exactly one protected POST", async () => {
  const office = createOffice({ holdPost: true });
  await settle();
  const button = office.elements.get("ozonRefreshButton");
  const firstClick = button.dispatch("click");
  await office.postStartedPromise;
  const secondClick = button.dispatch("click");
  office.releasePost();
  await Promise.all([firstClick, secondClick]);
  assert.equal(
    office.requests.filter(request =>
      request.path === "/api/ozon/sync" &&
      request.options.method === "POST"
    ).length,
    1
  );
  assert.equal(button.disabled, false);
});

test("refresh control is restored after a protected POST error", async () => {
  const office = createOffice({
    postResponse: {
      status: 503,
      body: { errorCode: "background_sync_unavailable" }
    }
  });
  await settle();
  const button = office.elements.get("ozonRefreshButton");
  await button.dispatch("click");
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-busy"), null);
  assert.match(
    office.elements.get("ozonRefreshMessage").textContent,
    /Не удалось обновить Ozon/
  );
});

test("mobile styles keep controls usable and the finance table locally scrollable", () => {
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
  assert.match(styles, /\.ozon-controls\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(styles, /\.ozon-sync-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.ozon-period-form\s*\{[^}]*display:\s*grid/s);
});
