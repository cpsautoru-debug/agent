
(() => {
  "use strict";

  const section = document.querySelector(
    '[data-section="ozonFinance"]'
  );

  const total = document.getElementById("ozonTotal");
  const totalNote = document.getElementById("ozonTotalNote");
  const articlesBody = document.getElementById("ozonArticlesBody");
  const articlesNote = document.getElementById("ozonArticlesNote");

  if (!section || !total || !totalNote || !articlesBody) {
    return;
  }

  const rubles = kopecks =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB"
    }).format(kopecks / 100);

  const number = value =>
    new Intl.NumberFormat("ru-RU").format(value);

  function showTableMessage(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 3;
    cell.textContent = message;
    cell.style.padding = "16px";

    row.append(cell);
    articlesBody.replaceChildren(row);
  }

  function reset() {
    total.textContent = "—";
    totalNote.textContent = "Требуется вход владельца";

    showTableMessage("Требуется вход владельца");

    if (articlesNote) {
      articlesNote.textContent =
        "Детализация: 01.10.2026–29.10.2026. " +
        "Месячная сводка: 01.10.2026–31.10.2026.";
    }
  }

  async function loadMonthlyReport() {
    const response = await fetch("/api/ozon/report", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Monthly report unavailable");
    }

    const report = await response.json();

    if (
      report.period !== "2026-10" ||
      !Number.isSafeInteger(report.totalKopecks)
    ) {
      throw new Error("Invalid monthly report");
    }

    total.textContent = rubles(report.totalKopecks);

    totalNote.textContent =
      `${number(report.processedDays)} дней · ` +
      `${number(report.recordsCount)} операций · ` +
      (
        report.reconciled && report.final
          ? "Отчёт сверён"
          : "Предварительный отчёт"
      );
  }

  async function loadArticles() {
    showTableMessage("Загрузка данных...");

    const response = await fetch("/api/ozon/articles", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Articles unavailable");
    }

    const data = await response.json();

    if (
      data.periodStart !== "2026-10-01" ||
      data.periodEnd !== "2026-10-29" ||
      data.currency !== "RUB" ||
      !Array.isArray(data.articles) ||
      !Number.isSafeInteger(data.totalOperations) ||
      !Number.isSafeInteger(data.totalKopecks)
    ) {
      throw new Error("Invalid articles report");
    }

    const fragment = document.createDocumentFragment();

    let operationsSum = 0;
    let amountSum = 0;

    for (const article of data.articles) {
      if (
        typeof article.article !== "string" ||
        !Number.isSafeInteger(article.operations) ||
        !Number.isSafeInteger(article.amountKopecks)
      ) {
        throw new Error("Invalid article row");
      }

      operationsSum += article.operations;
      amountSum += article.amountKopecks;

      const row = document.createElement("tr");

      const name = document.createElement("td");
      name.textContent = article.article;
      name.style.padding = "12px";
      name.style.borderBottom = "1px solid #e5e7e5";

      const count = document.createElement("td");
      count.textContent = number(article.operations);
      count.style.textAlign = "right";
      count.style.padding = "12px";
      count.style.borderBottom = "1px solid #e5e7e5";

      const amount = document.createElement("td");
      amount.textContent = rubles(article.amountKopecks);
      amount.style.textAlign = "right";
      amount.style.padding = "12px";
      amount.style.borderBottom = "1px solid #e5e7e5";
      amount.style.whiteSpace = "nowrap";

      row.append(name, count, amount);
      fragment.append(row);
    }

    if (
      operationsSum !== data.totalOperations ||
      amountSum !== data.totalKopecks
    ) {
      throw new Error("Articles totals mismatch");
    }

    const footer = document.createElement("tr");

    const label = document.createElement("td");
    label.textContent = "Итого";
    label.style.fontWeight = "700";
    label.style.padding = "14px 12px";

    const count = document.createElement("td");
    count.textContent = number(data.totalOperations);
    count.style.fontWeight = "700";
    count.style.textAlign = "right";
    count.style.padding = "14px 12px";

    const amount = document.createElement("td");
    amount.textContent = rubles(data.totalKopecks);
    amount.style.fontWeight = "700";
    amount.style.textAlign = "right";
    amount.style.padding = "14px 12px";
    amount.style.whiteSpace = "nowrap";

    footer.append(label, count, amount);
    fragment.append(footer);

    articlesBody.replaceChildren(fragment);

    if (articlesNote) {
      articlesNote.textContent =
        `Детализация за 1–29 октября 2026: ` +
        `${number(data.totalOperations)} операций. ` +
        `Сальдо ${rubles(data.totalKopecks)}. ` +
        `Себестоимость и чистая прибыль не рассчитаны.`;
    }
  }

  let requestId = 0;

  async function loadFinance() {
    const currentRequest = ++requestId;

    reset();

    try {
      const auth = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store"
      });

      if (currentRequest !== requestId) return;

      if (!auth.ok) return;

      const identity = await auth.json();

      if (currentRequest !== requestId) return;

      if (
        identity.authenticated !== true ||
        identity.role !== "owner"
      ) {
        return;
      }

      const results = await Promise.allSettled([
        loadMonthlyReport(),
        loadArticles()
      ]);

      if (currentRequest !== requestId) return;

      if (results[0].status === "rejected") {
        total.textContent = "—";
        totalNote.textContent = "Отчёт временно недоступен";
      }

      if (results[1].status === "rejected") {
        showTableMessage("Ошибка загрузки детализации");

        if (articlesNote) {
          articlesNote.textContent =
            "Не удалось получить данные по артикулам.";
        }
      }
    } catch {
      if (currentRequest !== requestId) return;

      totalNote.textContent = "Ошибка проверки доступа";
      showTableMessage("Ошибка проверки доступа");
    }
  }

  document.querySelectorAll(
    '[data-page="ozonFinance"]'
  ).forEach(link => {
    link.addEventListener("click", loadFinance);
  });

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

