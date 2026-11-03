(() => {
  "use strict";

  // Только Preview: этот скрипт отправляет файл на /api/ozon/xlsx-preview
  // и отображает ответ. Никаких запросов на запись (POST confirm) здесь
  // нет и не должно быть.

  const form = document.getElementById("ozonXlsxImportForm");
  const fileInput = document.getElementById("ozonXlsxImportFile");
  const submitButton = document.getElementById("ozonXlsxImportButton");
  const message = document.getElementById("ozonXlsxImportMessage");
  const reportBox = document.getElementById("ozonXlsxImportReport");
  const hashOut = document.getElementById("ozonXlsxImportHash");
  const rowsOut = document.getElementById("ozonXlsxImportRows");
  const controlTotalOut = document.getElementById(
    "ozonXlsxImportControlTotal"
  );
  const completenessOut = document.getElementById(
    "ozonXlsxImportCompleteness"
  );
  const reconciliationStatusOut = document.getElementById(
    "ozonXlsxImportReconciliationStatus"
  );
  const byDateBody = document.getElementById("ozonXlsxImportByDateBody");
  const byCategoryBody = document.getElementById(
    "ozonXlsxImportByCategoryBody"
  );

  if (
    !form || !fileInput || !submitButton || !message || !reportBox ||
    !hashOut || !rowsOut || !controlTotalOut || !completenessOut ||
    !reconciliationStatusOut || !byDateBody || !byCategoryBody
  ) return;

  const rubles = kopecks => Number.isSafeInteger(kopecks)
    ? (kopecks / 100).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    : "—";

  const CATEGORY_LABELS_RU = {
    SALE: "Продажи",
    RETURN: "Возвраты",
    OZON_COMMISSION: "Комиссия Ozon",
    LOGISTICS: "Логистика",
    ACQUIRING: "Эквайринг",
    PROMOTION_PER_ORDER: "Продвижение за заказ",
    ADS_CPC: "Реклама за клики",
    SUBSCRIPTION: "Подписки",
    WAREHOUSE_SERVICES: "Складские услуги",
    OTHER_DEDUCTION: "Прочие удержания",
    UNKNOWN: "Неопределённые операции"
  };

  const CONTROL_TOTAL_LABELS = {
    matches_computed_sum: "совпадает с суммой строк",
    mismatch: "расхождение с суммой строк",
    not_declared_in_report: "в отчёте не найдена"
  };

  const RECONCILIATION_LABELS = {
    api_comparison_skipped_no_service_binding: "сверка с API не выполнялась: Service Binding не настроен",
    no_operations_to_compare: "в отчёте нет операций для сверки",
    no_api_data_for_some_dates: "в тестовой базе нет данных API за часть дат",
    api_sync_incomplete_for_some_dates: "загрузка API за часть дат ещё не завершена",
    amount_mismatch_requires_manual_confirmation: "суммы Excel и API расходятся — требуется ручная проверка",
    amounts_match_pending_formal_reconciliation:
      "Суммы Excel и API совпадают. Формальная сверка ещё не подтверждена",
    amounts_match_confirmed_sync_complete:
      "суммы Excel и API совпадают, загрузка завершена, сверка формально подтверждена"
  };

  function renderReport(data) {
    hashOut.textContent = data.source.sha256;
    rowsOut.textContent =
      `${data.source.detailRows} (пропущено пустых: ${data.source.skippedBlankRows}, ` +
      `дублей: ${data.source.duplicateRows.length})`;
    controlTotalOut.textContent =
      `${rubles(data.totals.totalKopecks)} ₽ · ` +
      (CONTROL_TOTAL_LABELS[data.totals.controlTotalStatus] ||
        data.totals.controlTotalStatus);
    completenessOut.textContent =
      `${data.classification.completenessPercent}% ` +
      `(неопределённых: ${data.classification.unknownCount} из ` +
      `${data.classification.totalOperations})`;
    reconciliationStatusOut.textContent =
      RECONCILIATION_LABELS[data.reconciliationStatus] ||
      data.reconciliationStatus;

    byDateBody.textContent = "";
    for (const day of data.byDate) {
      const row = document.createElement("tr");
      row.innerHTML =
        `<td>${day.operationDate}</td>` +
        `<td>${day.count}</td>` +
        `<td>${rubles(day.totalKopecks)}</td>`;
      byDateBody.appendChild(row);
    }
    if (data.byDate.length === 0) {
      byDateBody.innerHTML = "<tr><td colspan=\"3\">Нет данных</td></tr>";
    }

    byCategoryBody.textContent = "";
    for (const category of data.byCategory) {
      const row = document.createElement("tr");
      const scope = category.scope;
      row.innerHTML =
        `<td>${CATEGORY_LABELS_RU[category.category] || category.category}</td>` +
        `<td>${category.count}</td>` +
        `<td>${rubles(category.totalKopecks)}</td>` +
        `<td>${scope.sku} / ${scope.order} / ${scope.shop}</td>`;
      byCategoryBody.appendChild(row);
    }
    if (data.byCategory.length === 0) {
      byCategoryBody.innerHTML = "<tr><td colspan=\"4\">Нет данных</td></tr>";
    }

    reportBox.hidden = false;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      message.textContent = "Выберите файл .xlsx.";
      return;
    }

    submitButton.disabled = true;
    message.textContent = "Загрузка и проверка файла…";
    reportBox.hidden = true;

    try {
      const body = new FormData();
      body.append("report", file, file.name);

      const response = await fetch("/api/ozon/xlsx-preview", {
        method: "POST",
        credentials: "same-origin",
        body
      });

      if (response.status === 401 || response.status === 403) {
        message.textContent =
          "Требуется вход владельца для проверки отчёта.";
        return;
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        message.textContent =
          `Ошибка проверки: ${(data && (data.errorCode || data.error)) ||
            `HTTP ${response.status}`}`;
        return;
      }

      message.textContent =
        "Preview выполнен. Запись в базу не производилась.";
      renderReport(data);
    } catch {
      message.textContent = "Не удалось выполнить проверку файла.";
    } finally {
      submitButton.disabled = false;
    }
  });
})();
