
(() => {
  "use strict";

  const section = document.querySelector('[data-section="ozonFinance"]');
  const total = document.getElementById("ozonTotal");
  const totalNote = document.getElementById("ozonTotalNote");

  if (!section || !total || !totalNote) return;

  const formatRubles = kopecks =>
    new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB"
    }).format(kopecks / 100);

  function reset() {
    total.textContent = "—";
    totalNote.textContent = "Требуется вход владельца";
  }

  async function loadFinance() {
    reset();

    try {
      const auth = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store"
      });

      if (!auth.ok) return;

      const identity = await auth.json();
      if (identity.authenticated !== true ||
          identity.role !== "owner") return;

      const response = await fetch("/api/ozon/report", {
        credentials: "same-origin",
        cache: "no-store"
      });

      if (!response.ok) {
        totalNote.textContent = "Отчёт временно недоступен";
        return;
      }

      const report = await response.json();

      if (
        report.period !== "2026-10" ||
        !Number.isSafeInteger(report.totalKopecks)
      ) {
        totalNote.textContent = "Ошибка проверки данных";
        return;
      }

      total.textContent = formatRubles(report.totalKopecks);

      totalNote.textContent =
        `${report.processedDays} дней · ` +
        `${report.recordsCount} операций · ` +
        (report.reconciled && report.final
          ? "Отчёт сверён"
          : "Предварительный отчёт");
    } catch {
      totalNote.textContent = "Ошибка загрузки данных";
    }
  }

  document.querySelectorAll('[data-page="ozonFinance"]').forEach(link => {
    link.addEventListener("click", () => {
      loadFinance();
    });
  });

  if (location.hash === "#ozonFinance") {
    loadFinance();
  }

  window.addEventListener("pageshow", () => {
    if (location.hash === "#ozonFinance") {
      loadFinance();
    }
  });
})();
