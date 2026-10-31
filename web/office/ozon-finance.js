
(() => {
  "use strict";

  const section = document.querySelector(
    '[data-section="ozonFinance"]'
  );
  const total = document.getElementById("ozonTotal");
  const totalNote = document.getElementById("ozonTotalNote");
  const articlesBody = document.getElementById("ozonArticlesBody");
  const articlesNote = document.getElementById("ozonArticlesNote");

  const costForm = document.getElementById("ozonCostForm");
  const costSku = document.getElementById("costSku");
  const costRubles = document.getElementById("costRubles");
  const costStatus = document.getElementById("costStatus");
  const costMessage = document.getElementById("costMessage");

  if (!section || !total || !totalNote || !articlesBody ||
      !costForm || !costSku || !costRubles ||
      !costStatus || !costMessage) return;

  const money = kopecks => new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB"
  }).format(kopecks / 100);

  const number = value =>
    new Intl.NumberFormat("ru-RU").format(value);

  const catalog = new Map();
  const savedCosts = new Map();
  let authorized = false;
  let requestId = 0;

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
  }

  function reset() {
    authorized = false;
    total.textContent = "—";
    totalNote.textContent = "Требуется вход владельца";
    tableMessage("Требуется вход владельца");
    costMessage.textContent = "Требуется вход владельца";
    catalog.clear();
    savedCosts.clear();
    costSku.replaceChildren(new Option("Выберите товар", ""));
    costRubles.value = "";
    costStatus.value = "preliminary";
    setFormEnabled(false);
  }

  async function getJSON(path) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store"
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
        loadCatalog()
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
