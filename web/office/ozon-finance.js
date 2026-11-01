
(() => {
  "use strict";

  const section = document.querySelector(
    '[data-section="ozonFinance"]'
  );
  const total = document.getElementById("ozonTotal");
  const totalNote = document.getElementById("ozonTotalNote");
  const articlesBody = document.getElementById("ozonArticlesBody");
  const articlesNote = document.getElementById("ozonArticlesNote");
  const apiSyncPeriod = document.getElementById("ozonApiSyncPeriod");
  const apiSyncSummary = document.getElementById("ozonApiSyncSummary");
  const lastSuccessfulSync = document.getElementById(
    "ozonLastSuccessfulSync"
  );
  const reconciliationSummary = document.getElementById(
    "ozonReconciliationSummary"
  );
  const apiSyncBody = document.getElementById("ozonApiSyncBody");
  const apiTotal = document.getElementById("ozonApiTotal");
  const apiPositive = document.getElementById("ozonApiPositive");
  const apiNegative = document.getElementById("ozonApiNegative");
  const apiPositiveNote = document.getElementById("ozonApiPositiveNote");
  const apiNegativeNote = document.getElementById("ozonApiNegativeNote");
  const apiCoverage = document.getElementById("ozonApiCoverage");
  const apiCoverageNote = document.getElementById("ozonApiCoverageNote");
  const apiChart = document.getElementById("ozonApiChart");
  const categoriesBody = document.getElementById("ozonCategoriesBody");
  const operationsBody = document.getElementById("ozonOperationsBody");
  const operationsNote = document.getElementById("ozonOperationsNote");
  const periodForm = document.getElementById("ozonPeriodForm");
  const periodStartInput = document.getElementById("ozonPeriodStart");
  const periodEndInput = document.getElementById("ozonPeriodEnd");
  const refreshButton = document.getElementById("ozonRefreshButton");
  const refreshMessage = document.getElementById("ozonRefreshMessage");

  const costForm = document.getElementById("ozonCostForm");
  const costSku = document.getElementById("costSku");
  const costRubles = document.getElementById("costRubles");
  const costStatus = document.getElementById("costStatus");
  const costMessage = document.getElementById("costMessage");

  if (!section || !total || !totalNote || !articlesBody ||
      !apiSyncPeriod || !apiSyncSummary || !apiSyncBody ||
      !lastSuccessfulSync || !reconciliationSummary ||
      !apiTotal || !apiPositive || !apiNegative ||
      !apiPositiveNote || !apiNegativeNote ||
      !apiCoverage || !apiCoverageNote || !apiChart ||
      !categoriesBody || !operationsBody || !operationsNote ||
      !periodForm || !periodStartInput || !periodEndInput ||
      !refreshButton || !refreshMessage ||
      !costForm || !costSku || !costRubles ||
      !costStatus || !costMessage) return;

  const money = kopecks => Number.isSafeInteger(kopecks)
    ? new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB"
      }).format(kopecks / 100)
    : "Нет данных";

  const number = value => Number.isSafeInteger(value)
    ? new Intl.NumberFormat("ru-RU").format(value)
    : "Нет данных";

  function apiSyncTableMessage(message) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.style.padding = "16px";
    td.textContent = message;
    tr.append(td);
    apiSyncBody.replaceChildren(tr);
  }

  function resetApiDashboard(message) {
    apiTotal.textContent = "—";
    apiPositive.textContent = "—";
    apiNegative.textContent = "—";
    apiPositiveNote.textContent = "Начисления с плюсовым знаком";
    apiNegativeNote.textContent = "Удержания с минусовым знаком";
    apiCoverage.textContent = "—";
    apiCoverageNote.textContent = "Загрузка и сверка";
    apiChart.textContent = message;
    categoriesBody.replaceChildren();
    operationsBody.replaceChildren();
    operationsNote.textContent = "Прибыль пока не рассчитана";
  }

  function resetApiSync() {
    apiSyncPeriod.textContent = "Последние даты · не сверено";
    apiSyncSummary.textContent = "Требуется вход владельца";
    lastSuccessfulSync.textContent =
      "Последнее успешное обновление: нет данных";
    reconciliationSummary.textContent =
      "Нетто-сверка и детализация пока не подтверждены.";
    apiSyncTableMessage("Требуется вход владельца");
    resetApiDashboard("Требуется вход владельца");
    refreshMessage.textContent = "Ручное обновление доступно владельцу.";
  }

  const catalog = new Map();
  const savedCosts = new Map();
  let authorized = false;
  let requestId = 0;
  let latestApiRunStatus = "not_started";

  function tableMessage(message) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.style.padding = "16px";
    td.textContent = message;
    tr.append(td);
    articlesBody.replaceChildren(tr);
  }

  function setFormEnabled(enabled) {
    costSku.disabled = !enabled;
    costRubles.disabled = !enabled;
    costStatus.disabled = !enabled;
    costForm.querySelector('button[type="submit"]').disabled =
      !enabled;
    periodStartInput.disabled = !enabled;
    periodEndInput.disabled = !enabled;
    periodForm.querySelector('button[type="submit"]').disabled =
      !enabled;
    refreshButton.disabled = !enabled;
  }

  function reset() {
    authorized = false;
    total.textContent = "—";
    totalNote.textContent = "Требуется вход владельца";
    tableMessage("Требуется вход владельца");
    resetApiSync();
    costMessage.textContent = "Требуется вход владельца";
    catalog.clear();
    savedCosts.clear();
    costSku.replaceChildren(new Option("Выберите товар", ""));
    costRubles.value = "";
    costStatus.value = "preliminary";
    setFormEnabled(false);
  }

  async function getJSON(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${path}`);
    }
    return response.json();
  }

  async function loadMonthly() {
    const report = await getJSON("/api/ozon/report");
    if (report.period !== "2026-10" ||
        !Number.isSafeInteger(report.totalKopecks)) {
      throw new Error("Invalid monthly report");
    }
    total.textContent = money(report.totalKopecks);
    totalNote.textContent =
      `${number(report.processedDays)} дней · ` +
      `${number(report.recordsCount)} операций · ` +
      (report.reconciled && report.final
        ? "Отчёт сверён"
        : "Предварительный отчёт");
  }

  async function loadArticles() {
    tableMessage("Загрузка данных...");
    const data = await getJSON("/api/ozon/articles");

    if (data.periodStart !== "2026-10-01" ||
        data.periodEnd !== "2026-10-29" ||
        !Array.isArray(data.articles) ||
        !Number.isSafeInteger(data.totalKopecks) ||
        !Number.isSafeInteger(data.totalOperations)) {
      throw new Error("Invalid article report");
    }

    const fragment = document.createDocumentFragment();
    let count = 0;
    let sum = 0;

    for (const item of data.articles) {
      if (typeof item.article !== "string" ||
          !Number.isSafeInteger(item.operations) ||
          !Number.isSafeInteger(item.amountKopecks)) {
        throw new Error("Invalid article");
      }

      count += item.operations;
      sum += item.amountKopecks;

      const tr = document.createElement("tr");
      const cells = [
        item.article,
        number(item.operations),
        money(item.amountKopecks)
      ];

      cells.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        td.style.padding = "12px";
        td.style.borderBottom = "1px solid #e5e7e5";
        if (index) td.style.textAlign = "right";
        if (index === 2) td.style.whiteSpace = "nowrap";
        tr.append(td);
      });

      fragment.append(tr);
    }

    if (count !== data.totalOperations ||
        sum !== data.totalKopecks) {
      throw new Error("Article totals mismatch");
    }

    const tr = document.createElement("tr");
    ["Итого", number(count), money(sum)].forEach((value, i) => {
      const td = document.createElement("td");
      td.textContent = value;
      td.style.padding = "14px 12px";
      td.style.fontWeight = "700";
      if (i) td.style.textAlign = "right";
      tr.append(td);
    });
    fragment.append(tr);
    articlesBody.replaceChildren(fragment);

    if (articlesNote) {
      articlesNote.textContent =
        `1–29 октября 2026 · ${number(count)} операций · ` +
        `${money(sum)}. Это не чистая прибыль.`;
    }
  }

  async function loadApiSyncStatus({ recent = false } = {}) {
    const params = new URLSearchParams();
    if (!recent && periodStartInput.value && periodEndInput.value) {
      params.set("start", periodStartInput.value);
      params.set("end", periodEndInput.value);
    } else if (!recent &&
        (periodStartInput.value || periodEndInput.value)) {
      throw new Error("Both period bounds are required");
    }
    const suffix = params.size ? `?${params}` : "";
    const data = await getJSON(`/api/ozon/sync-status${suffix}`);

    if (
      data.source !== "ozon_seller_api" ||
      data.currency !== "RUB" ||
      typeof data.periodStart !== "string" ||
      typeof data.periodEnd !== "string" ||
      !Array.isArray(data.daily) ||
      !Array.isArray(data.categories) ||
      !Array.isArray(data.operations) ||
      !data.totals ||
      !data.coverage ||
      ![data.totals.totalKopecks, data.totals.positiveKopecks,
        data.totals.negativeKopecks, data.totals.recordCount]
        .every(value => value === null || Number.isSafeInteger(value)) ||
      !(
        data.lastSuccessfulAt === null ||
        typeof data.lastSuccessfulAt === "string"
      ) ||
      !data.componentVerification ||
      data.componentVerification.status !== "unverified" ||
      typeof data.componentVerification.reason !== "string" ||
      !(
        data.latestRun === null ||
        (
          data.latestRun &&
          typeof data.latestRun.status === "string"
        )
      )
    ) {
      throw new Error("Invalid Ozon sync status");
    }

    if (recent || !periodStartInput.value) {
      periodStartInput.value = data.periodStart;
    }
    if (recent || !periodEndInput.value) {
      periodEndInput.value = data.periodEnd;
    }

    apiSyncPeriod.textContent =
      `${data.periodStart} — ${data.periodEnd} · Seller API`;

    const statusLabels = {
      complete: "Страницы API загружены",
      partial: "Загрузка неполная",
      failed: "Последняя загрузка завершилась ошибкой",
      running: "Синхронизация выполняется",
      skipped: "Запуск пропущен: синхронизация уже выполняется"
    };
    const run = data.latestRun;
    latestApiRunStatus = run?.status || "not_started";
    let summary = run
      ? statusLabels[run.status] || "Состояние синхронизации неизвестно"
      : "Синхронизация ещё не выполнялась";

    if (
      run &&
      typeof run.errorCode === "string" &&
      /^[a-z0-9_]+$/.test(run.errorCode)
    ) {
      summary += ` · код: ${run.errorCode}`;
    }

    if (run && Number.isSafeInteger(run.retryCount) && run.retryCount > 0) {
      summary += ` · повторов запроса: ${number(run.retryCount)}`;
    }

    if (run && typeof run.finishedAt === "string") {
      const completedAt = new Date(run.finishedAt);
      if (!Number.isNaN(completedAt.getTime())) {
        summary += ` · обновлено ${new Intl.DateTimeFormat(
          "ru-RU",
          {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Europe/Moscow"
          }
        ).format(completedAt)}`;
      }
    }

    apiSyncSummary.textContent = summary;
    if (data.lastSuccessfulAt) {
      const completedAt = new Date(data.lastSuccessfulAt);
      lastSuccessfulSync.textContent =
        `Последнее успешное обновление: ${
          Number.isNaN(completedAt.getTime())
            ? "время не определено"
            : new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Europe/Moscow"
              }).format(completedAt)
        }`;
    } else {
      lastSuccessfulSync.textContent =
        "Последнее успешное обновление за период: нет данных";
    }

    const safeInt = value => Number.isSafeInteger(value);
    if (
      !safeInt(data.coverage.days) ||
      !safeInt(data.coverage.completeDays) ||
      !safeInt(data.coverage.reconciledDays)
    ) {
      throw new Error("Invalid Ozon coverage");
    }

    apiTotal.textContent = money(data.totals.totalKopecks);
    apiPositive.textContent = money(data.totals.positiveKopecks);
    apiNegative.textContent = money(data.totals.negativeKopecks);
    apiPositiveNote.textContent =
      `${number(data.totals.positiveCount || 0)} положительных операций`;
    apiNegativeNote.textContent =
      `${number(data.totals.negativeCount || 0)} отрицательных операций`;
    apiCoverage.textContent =
      `${number(data.coverage.completeDays)} / ` +
      `${number(data.coverage.days)} дней`;
    apiCoverageNote.textContent =
      `${number(data.coverage.reconciledDays)} дней сверено · ` +
      (data.reconciled ? "отчёт сверён" : "есть несверенные данные");
    const netVerifiedDays = data.daily.filter(day =>
      day.complete && day.netStatus === "verified"
    ).length;
    const componentReasonLabels = {
      ozon_api_component_mapping_incomplete:
        "API-детализация ещё не классифицирована и не сопоставлена построчно с отчётом",
      official_report_not_registered:
        "официальный отчёт не записан в журнал нетто-сверки"
    };
    const componentReason = componentReasonLabels[
      data.componentVerification.reason
    ] || "причина не распознана";
    reconciliationSummary.textContent =
      `Нетто сверено: ${number(netVerifiedDays)} из ` +
      `${number(data.coverage.completeDays)} полных дней; ` +
      `${data.reconciled ? "полная сверка подтверждена" : "полная сверка не подтверждена"}. ` +
      `Комиссии, логистика, реклама и прочая детализация не проверены: ` +
      componentReason + ".";

    const fragment = document.createDocumentFragment();

    for (const day of data.daily) {
      if (
        typeof day.date !== "string" ||
        ![day.recordCount, day.totalKopecks, day.positiveKopecks,
          day.negativeKopecks].every(value =>
          value === null || Number.isSafeInteger(value)
        ) ||
        !["verified", "unverified"].includes(day.netStatus) ||
        !["verified", "unverified"].includes(day.detailStatus) ||
        typeof day.complete !== "boolean" ||
        typeof day.reconciled !== "boolean"
      ) {
        throw new Error("Invalid Ozon sync day");
      }

      const tr = document.createElement("tr");
      const state = day.complete ? "Полная загрузка" : day.status;
      const reconciliation = day.discrepancyCount > 0
        ? `Расхождений: ${number(day.discrepancyCount)}`
        : day.reconciled
          ? "Сверено"
          : day.netStatus === "verified"
            ? "Нетто сверено · детали не сверены"
            : "Не сверено";
      const dayStatus = day.errorCode
        ? `${state} · ${day.errorCode} · ${reconciliation}`
        : `${state} · ${reconciliation}`;
      const cells = [
        day.date,
        number(day.recordCount),
        money(day.positiveKopecks),
        money(day.negativeKopecks),
        money(day.totalKopecks),
        dayStatus
      ];

      cells.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (index > 0 && index < 5) {
          td.style.textAlign = "right";
        }
        if (index > 1 && index < 5) td.style.whiteSpace = "nowrap";
        tr.append(td);
      });

      fragment.append(tr);
    }

    if (data.daily.length === 0) {
      apiSyncTableMessage("За выбранный период нет данных");
    } else {
      apiSyncBody.replaceChildren(fragment);
    }

    renderApiChart(data.daily);
    renderApiCategories(data.categories);
    renderApiOperations(data.operations, data.truncated);
  }

  function renderApiChart(days) {
    const knownDays = days.filter(day =>
      Number.isSafeInteger(day.totalKopecks)
    );
    if (knownDays.length === 0) {
      apiChart.textContent = "Нет данных для графика";
      return;
    }

    const maximum = Math.max(
      1,
      ...knownDays.map(day => Math.abs(day.totalKopecks))
    );
    const fragment = document.createDocumentFragment();
    for (const day of days) {
      const row = document.createElement("div");
      row.className = "ozon-chart-row";
      const date = document.createElement("span");
      date.className = "ozon-chart-date";
      date.textContent = day.date;
      const track = document.createElement("div");
      track.className = "ozon-chart-track";
      track.setAttribute("aria-hidden", "true");
      const bar = document.createElement("div");
      if (Number.isSafeInteger(day.totalKopecks)) {
        bar.className = `ozon-chart-bar${
          day.totalKopecks < 0 ? " negative" : ""
        }`;
        bar.style.width = `${
          Math.max(2, Math.round(
            Math.abs(day.totalKopecks) / maximum * 100
          ))
        }%`;
        track.append(bar);
      }
      const amount = document.createElement("span");
      amount.className = "ozon-chart-value";
      amount.textContent = money(day.totalKopecks);
      row.append(date, track, amount);
      fragment.append(row);
    }
    apiChart.replaceChildren(fragment);
  }

  function renderApiCategories(categories) {
    const fragment = document.createDocumentFragment();
    for (const item of categories) {
      if (
        typeof item.category !== "string" ||
        !Number.isSafeInteger(item.recordCount) ||
          !Number.isSafeInteger(item.totalKopecks) ||
          !Number.isSafeInteger(item.positiveKopecks) ||
          !Number.isSafeInteger(item.negativeKopecks)
      ) {
        throw new Error("Invalid Ozon category");
      }

      const tr = document.createElement("tr");
      const cells = [
        item.category,
        number(item.recordCount),
        money(item.positiveKopecks),
        money(item.negativeKopecks),
        money(item.totalKopecks)
      ];
      cells.forEach((value, index) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (index > 0) td.style.textAlign = "right";
        tr.append(td);
      });
      fragment.append(tr);
    }
    if (categories.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "Нет начислений за выбранный период";
      row.append(cell);
      fragment.append(row);
    }
    categoriesBody.replaceChildren(fragment);
  }

  function renderApiOperations(operations, truncated) {
    const fragment = document.createDocumentFragment();
    for (const operation of operations) {
      if (
        typeof operation.accrualId !== "string" ||
        typeof operation.date !== "string" ||
        typeof operation.category !== "string" ||
        !Number.isSafeInteger(operation.totalKopecks) ||
        !Array.isArray(operation.components)
      ) {
        throw new Error("Invalid Ozon operation");
      }

      const tr = document.createElement("tr");
      const identity = document.createElement("td");
      identity.textContent =
        `${operation.date} · ${operation.accrualId}`;
      const category = document.createElement("td");
      category.textContent =
        `${operation.category} · ${operation.unitNumber || "без отправления"}`;
      const amount = document.createElement("td");
      amount.textContent = money(operation.totalKopecks);
      const detailCell = document.createElement("td");
      const details = document.createElement("div");
      details.className = "ozon-operation-detail";
      if (operation.components.length === 0) {
        details.textContent = "Детализация SKU отсутствует";
      } else {
        for (const component of operation.components) {
          const detail = document.createElement("span");
          detail.textContent =
            `SKU ${component.sku} · ${component.typeName} · ` +
            money(component.amountKopecks);
          details.append(detail);
        }
      }
      detailCell.append(details);
      const credibility = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "ozon-credibility";
      badge.textContent = operation.reconciled
        ? "Сверено с отчётом"
        : "API · не сверено";
      credibility.append(badge);
      tr.append(identity, category, amount, detailCell, credibility);
      fragment.append(tr);
    }

    if (operations.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "Нет операций за выбранный период";
      row.append(cell);
      fragment.append(row);
    }
    operationsBody.replaceChildren(fragment);
    operationsNote.textContent = truncated
      ? "Прибыль пока не рассчитана · показаны первые 500 операций"
      : "Прибыль пока не рассчитана · нет подтверждённого полного набора себестоимости и связей SKU";
  }

  periodForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!authorized) return;
    if (
      !periodStartInput.value ||
      !periodEndInput.value ||
      periodStartInput.value > periodEndInput.value
    ) {
      apiSyncSummary.textContent =
        "Укажите корректные даты начала и окончания периода.";
      return;
    }
    try {
      await loadApiSyncStatus();
    } catch {
      apiSyncSummary.textContent =
        "Не удалось загрузить период. Проверьте даты и доступ.";
    }
  });

  async function startRecentSync() {
    if (!authorized) return;
    refreshButton.disabled = true;
    refreshMessage.textContent = "Запрашиваем защищённую синхронизацию…";
    try {
      const response = await fetch("/api/ozon/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (response.status !== 202 || result.status !== "started") {
        throw new Error(result.errorCode || `HTTP ${response.status}`);
      }

      refreshMessage.textContent =
        `Запуск ${result.periodStart} — ${result.periodEnd} принят. ` +
        "История операций сохраняется отдельно.";
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        await loadApiSyncStatus();
        if (latestApiRunStatus !== "running") break;
      }
      if (latestApiRunStatus === "running") {
        refreshMessage.textContent =
          "Синхронизация продолжается в фоне. Обновите статус позже.";
      } else {
        refreshMessage.textContent =
          `Последний статус: ${latestApiRunStatus}.`;
      }
    } catch {
      refreshMessage.textContent =
        "Не удалось обновить Ozon. Проверьте статус синхронизации.";
    } finally {
      refreshButton.disabled = !authorized;
    }
  }

  refreshButton.addEventListener("click", startRecentSync);
  async function loadCosts() {
    const data = await getJSON("/api/ozon/costs");

    if (!Array.isArray(data.costs)) {
      throw new Error("Invalid costs response");
    }

    savedCosts.clear();
    for (const item of data.costs) {
      if (typeof item.sku === "string") {
        savedCosts.set(item.sku, item);
      }
    }

    const selected = costSku.value;
    costSku.replaceChildren(new Option("Выберите товар", ""));

    for (const item of catalog.values()) {
      const option = new Option(
        `${item.article} · SKU ${item.sku}`,
        item.sku
      );
      costSku.append(option);
    }

    if (catalog.has(selected)) costSku.value = selected;
    updateCostFields();
  }

  function updateCostFields() {
    const saved = savedCosts.get(costSku.value);
    costRubles.value = saved
      ? (saved.cost_kopecks / 100).toFixed(2)
      : "";
    costStatus.value = saved?.status || "preliminary";
    costMessage.textContent = saved
      ? `Сохранено: ${money(saved.cost_kopecks)} · ` +
        (saved.status === "confirmed"
          ? "Подтверждённая"
          : "Предварительная")
      : "Выберите товар и укажите себестоимость.";
  }

  costSku.addEventListener("change", updateCostFields);

  function detectModel(article) {
    const name = article.toLowerCase();

    if (name.includes("искра")) return "Lada Iskra";
    if (name.includes("приора")) return "Lada Priora";
    if (name.includes("кросс") || name.includes("cross")) {
      return "Lada Vesta Cross";
    }
    if (name.includes("веста")) return "Lada Vesta";

    return "Модель не определена";
  }

  async function loadCatalog() {
    const data = await getJSON("/api/ozon/articles");

    if (!Array.isArray(data.articles)) {
      throw new Error("Invalid catalog");
    }

    // API статей пока группирует данные по артикулу,
    // но не возвращает SKU.
    // Используем только достоверные соответствия
    // из ранее проверенной выгрузки Ozon.
    const known = [
      ["5023073005", "веста кросс-оранжевая поддержка-оранжевые соты", "Lada Vesta Cross"],
      ["5633152395", "веста-коричневая", "Lada Vesta"],
      ["3823761504", "чехлы-веста13", "Lada Vesta"],
      ["279183501", "0100016", "Lada Vesta"],
      ["279185960", "0100020", "Lada Vesta"],
      ["279184652", "010001", "Lada Vesta"],
      ["4823028480", "чехлы-веста с кокеткой-белая поддержка-белые соты", "Lada Vesta"],
      ["279184172", "0100013", "Lada Vesta"],
      ["279191257", "0100021", "Lada Vesta"],
      ["4866138075", "искра с оранжевой поддержкой", "Lada Iskra"],
      ["1606896016", "24605", "Lada Priora"],
      ["1606894548", "24604", "Lada Priora"],
      ["3974064759", "чехлы-веста14", "Lada Vesta"]
    ];

    catalog.clear();

    for (const [sku, article, model] of known) {
      if (data.articles.some(
        row => row.article === article
      )) {
        catalog.set(sku, { sku, article, model });
      }
    }

    await loadCosts();
  }

  costForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!authorized) return;

    const item = catalog.get(costSku.value);
    const raw = costRubles.value.trim();

    if (!item || !/^\d+(\.\d{1,2})?$/.test(raw)) {
      costMessage.textContent =
        "Выберите товар и укажите корректную сумму.";
      return;
    }

    const [whole, cents = ""] = raw.split(".");
    const costKopecks =
      Number(whole) * 100 +
      Number(cents.padEnd(2, "0"));

    if (!Number.isSafeInteger(costKopecks) ||
        costKopecks <= 0 ||
        costKopecks > 100000000) {
      costMessage.textContent = "Недопустимая сумма.";
      return;
    }

    const button = costForm.querySelector(
      'button[type="submit"]'
    );

    button.disabled = true;
    costMessage.textContent = "Сохранение...";

    try {
      const response = await fetch("/api/ozon/costs", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: item.sku,
          sellerArticle: item.article,
          model: item.model,
          costKopecks,
          status: costStatus.value,
          source: "Ручной ввод владельца в онлайн-офис"
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      savedCosts.set(item.sku, {
        sku: item.sku,
        cost_kopecks: costKopecks,
        status: costStatus.value
      });

      costMessage.textContent =
        `Сохранено: ${money(costKopecks)} · ` +
        (costStatus.value === "confirmed"
          ? "Подтверждённая"
          : "Предварительная");
    } catch {
      costMessage.textContent =
        "Не удалось сохранить. Проверьте доступ.";
    } finally {
      button.disabled = false;
    }
  });

  async function loadFinance() {
    const current = ++requestId;
    reset();

    try {
      const identity = await getJSON("/api/auth/me");

      if (current !== requestId) return;

      if (identity.authenticated !== true ||
          identity.role !== "owner") return;

      authorized = true;
      setFormEnabled(true);

      const results = await Promise.allSettled([
        loadMonthly(),
        loadArticles(),
        loadCatalog(),
        loadApiSyncStatus()
      ]);

      if (current !== requestId) return;

      if (results[0].status === "rejected") {
        totalNote.textContent = "Отчёт недоступен";
      }

      if (results[1].status === "rejected") {
        tableMessage("Ошибка загрузки начислений");
      }

      if (results[2].status === "rejected") {
        costMessage.textContent =
          "Ошибка загрузки справочника себестоимости";
      }

      if (results[3].status === "rejected") {
        apiSyncSummary.textContent =
          "Не удалось загрузить статус синхронизации";
        apiSyncTableMessage("Проверьте доступ и состояние сервиса");
      }
    } catch {
      if (current !== requestId) return;
      costMessage.textContent =
        "Требуется вход владельца";
    }
  }

  document.querySelectorAll(
    '[data-page="ozonFinance"]'
  ).forEach(link => link.addEventListener("click", loadFinance));

  window.addEventListener("hashchange", () => {
    if (location.hash.startsWith("#ozonFinance")) {
      loadFinance();
    }
  });

  window.addEventListener("pageshow", () => {
    if (location.hash.startsWith("#ozonFinance")) {
      loadFinance();
    }
  });

  if (location.hash.startsWith("#ozonFinance")) {
    loadFinance();
  }
})();
