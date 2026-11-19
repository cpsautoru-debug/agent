(() => {
  'use strict';

  const get = id => document.getElementById(id);
  const form = get('wbImportPreviewForm');
  const submitButton = get('wbImportPreviewSubmit');
  const clearButton = get('wbImportPreviewClear');
  const status = get('wbImportPreviewStatus');
  const result = get('wbImportPreviewResult');
  const xlsxInput = get('wbImportPreviewXlsx');
  const catalogInput = get('wbImportPreviewCatalog');
  const reportInput = get('wbImportPreviewReportId');
  const payoutInput = get('wbImportPreviewPayout');
  const breakdownRows = get('wbImportPreviewSkuRows');
  const names = {
    payout: 'wbImportPreviewPayoutResult',
    cogs: 'wbImportPreviewCogs',
    tax: 'wbImportPreviewTax',
    conservative: 'wbImportPreviewConservative',
    restored: 'wbImportPreviewRestored',
    sales: 'wbImportPreviewSales',
    returns: 'wbImportPreviewReturns',
    quality: 'wbImportPreviewQuality'
  };
  if (![form, submitButton, clearButton, status, result, xlsxInput, catalogInput,
        reportInput, payoutInput, breakdownRows].every(Boolean)) return;
  const outputs = Object.fromEntries(Object.entries(names).map(([key, id]) => [key, get(id)]));
  if (!Object.values(outputs).every(Boolean)) return;

  const currency = new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const maxXlsx = 2 * 1024 * 1024;
  const maxCatalog = 128 * 1024;
  const states = ['CONFIRMED_BY_USER', 'REFERENCE_UNVERIFIED', 'ASSUMED_UNCONFIRMED'];
  const stateLabels = {
    CONFIRMED_BY_USER: 'Подтверждено владельцем',
    REFERENCE_UNVERIFIED: 'Справочная стоимость (не проверена)',
    ASSUMED_UNCONFIRMED: 'Допущение (не подтверждено)'
  };
  let revision = 0;
  let controller = null;

  function rub(kop) { return currency.format(kop / 100); }
  function safeInteger(value, nonnegative = false) {
    return Number.isSafeInteger(value) && (!nonnegative || value >= 0);
  }
  function moneyToKop(raw) {
    const text = String(raw).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Введите контрольную выплату в рублях, максимум 2 знака после запятой.');
    const [whole, fraction = ''] = text.split('.');
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Сумма слишком большая.');
    return Number(amount);
  }
  function getRequest() {
    const reportId = reportInput.value.trim();
    if (!/^\d{1,20}$/.test(reportId)) throw new Error('Укажите номер отчёта WB (только цифры, до 20).');
    const payoutKop = moneyToKop(payoutInput.value);
    const xlsx = xlsxInput.files?.[0];
    const catalog = catalogInput.files?.[0];
    if (!xlsx || !catalog) throw new Error('Выберите отчёт XLSX и приватный справочник JSON.');
    if (!/\.xlsx$/i.test(xlsx.name) || !/\.json$/i.test(catalog.name)) {
      throw new Error('Нужны файлы .xlsx и .json.');
    }
    if (!safeInteger(xlsx.size, true) || xlsx.size < 200 || xlsx.size > maxXlsx ||
        !safeInteger(catalog.size, true) || catalog.size < 2 || catalog.size > maxCatalog) {
      throw new Error('Размер XLSX должен быть до 2 МБ, JSON — до 128 КБ.');
    }
    return { reportId, payoutKop, xlsx, catalog };
  }
  function validPreview(data, request) {
    const e = data?.estimate;
    if (!(data && typeof data === 'object' && e && typeof e === 'object' &&
      data.service === 'wb_finance' && data.kind === 'xlsx_profit_preview' &&
      data.persisted === false && data.readOnly === true && data.reportAvailable === false &&
      data.source === 'XLSX_WITH_PRIVATE_SKU_CATALOG' &&
      data.reportId === request.reportId && e.reportId === request.reportId &&
      data.dataVerified === false && data.profitStatus === 'UNVERIFIED' &&
      data.wbPayoutReconciliation === 'MATCHED_MANUAL_TARGET' &&
      data.taxBasisStatus === 'ASSUMED_8_PERCENT_NOT_FNS_VERIFIED' &&
      data.returnValueStatus === 'REFERENCE_COST_NOT_ORIGINAL_SALE_VERIFIED' &&
      data.additionalExpensesStatus === 'NOT_RECONCILED' &&
      e.dataVerified === false && e.profitStatus === 'UNVERIFIED' &&
      e.taxBasisStatus === 'ASSUMED' && e.taxRatePercent === 8 &&
      e.returnState === 'UNCONFIRMED' && e.additionalExpensesStatus === 'NOT_RECONCILED' &&
      e.payoutKop === request.payoutKop &&
      safeInteger(e.cogsKop, true) && safeInteger(e.taxKop, true) &&
      safeInteger(e.returnedCogsKop, true) &&
      safeInteger(e.profitWithoutRestorationKop) && safeInteger(e.profitWithRestorationKop) &&
      safeInteger(data.sales, true) && data.sales > 0 &&
      safeInteger(data.returns, true) && safeInteger(data.skuCount, true) &&
      data.skuCount > 0 && data.skuCount <= 1000 &&
      Array.isArray(data.breakdown) && data.breakdown.length === data.skuCount &&
      data.cogsQuality && typeof data.cogsQuality === 'object')) return false;

    if (BigInt(e.payoutKop) - BigInt(e.cogsKop) - BigInt(e.taxKop) !== BigInt(e.profitWithoutRestorationKop) ||
        BigInt(e.profitWithoutRestorationKop) + BigInt(e.returnedCogsKop) !== BigInt(e.profitWithRestorationKop)) return false;

    const quality = Object.fromEntries(states.map(s => [s, { units: 0n, cost: 0n }]));
    let sales = 0n; let returns = 0n; let soldTotal = 0n; let returnTotal = 0n;
    const seen = new Set();
    for (const line of data.breakdown) {
      if (!line || typeof line.sku !== 'string' || !line.sku || seen.has(line.sku) ||
          !states.includes(line.costStatus) ||
          !safeInteger(line.sales, true) || !safeInteger(line.returns, true) ||
          !safeInteger(line.unitCostKop, true) ||
          !safeInteger(line.soldCostKop, true) || !safeInteger(line.returnCostKop, true)) return false;
      if (BigInt(line.sales) * BigInt(line.unitCostKop) !== BigInt(line.soldCostKop) ||
          BigInt(line.returns) * BigInt(line.unitCostKop) !== BigInt(line.returnCostKop)) return false;
      seen.add(line.sku);
      sales += BigInt(line.sales);
      returns += BigInt(line.returns);
      soldTotal += BigInt(line.soldCostKop);
      returnTotal += BigInt(line.returnCostKop);
      quality[line.costStatus].units += BigInt(line.sales);
      quality[line.costStatus].cost += BigInt(line.soldCostKop);
    }
    if (sales !== BigInt(data.sales) || returns !== BigInt(data.returns) ||
        soldTotal !== BigInt(e.cogsKop) || returnTotal !== BigInt(e.returnedCogsKop)) return false;
    for (const s of states) {
      const q = data.cogsQuality[s];
      if (!q || !safeInteger(q.units, true) || !safeInteger(q.costKop, true) ||
          BigInt(q.units) !== quality[s].units || BigInt(q.costKop) !== quality[s].cost) return false;
    }
    return true;
  }

  function hide() {
    result.hidden = true;
    breakdownRows.replaceChildren();
    for (const field of Object.values(outputs)) field.textContent = '—';
  }
  function invalidate(message) {
    revision += 1;
    if (controller) { controller.abort(); controller = null; }
    submitButton.disabled = false;
    hide();
    status.textContent = message;
  }
  form.addEventListener('input', () => invalidate('Данные изменены. Повторите расчёт.'));
  form.addEventListener('change', () => invalidate('Выбран другой файл или изменены данные. Повторите расчёт.'));
  clearButton.addEventListener('click', () => {
    form.reset();
    invalidate('Поля и результаты очищены. Данные не сохранены.');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    invalidate('Проверяем введённые данные.');
    let request;
    try { request = getRequest(); }
    catch (error) { status.textContent = error.message; return; }
    const activeRevision = revision;
    const aborter = new AbortController();
    controller = aborter;
    submitButton.disabled = true;
    status.textContent = 'Проверяем XLSX и себестоимость через защищённый API. Результат не сохраняется.';
    const body = new FormData();
    body.append('xlsx', request.xlsx, request.xlsx.name);
    body.append('catalog', request.catalog, request.catalog.name);
    body.append('reportId', request.reportId);
    body.append('expectedPayoutRub', (BigInt(request.payoutKop) / 100n).toString() + '.' +
      (BigInt(request.payoutKop) % 100n).toString().padStart(2, '0'));

    try {
      const response = await fetch('/api/wb/import-preview', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'X-WB-Import-Preview': '1' }, body, signal: aborter.signal
      });
      if (activeRevision !== revision) return;
      if (!response.ok) {
        const messages = {
          400: 'Неверные параметры отчёта или состава файлов.',
          401: 'Требуется вход владельца в онлайн-офис.',
          403: 'Доступен только владельцу или неверный источник запроса.',
          404: 'API импорта недоступен в этом окружении.',
          413: 'Файлы превышают допустимый размер.',
          415: 'Неверный формат запроса или файла.',
          422: 'XLSX, себестоимость или контрольная выплата не прошли сверку.',
          503: 'Сервис импорта временно недоступен.'
        };
        status.textContent = messages[response.status] || 'Расчёт не выполнен.';
        return;
      }
      const data = await response.json();
      if (activeRevision !== revision) return;
      if (!validPreview(data, request)) {
        status.textContent = 'Ответ сервера не прошёл проверку. Финансовый результат скрыт.';
        return;
      }
      outputs.payout.textContent = rub(data.estimate.payoutKop);
      outputs.cogs.textContent = rub(data.estimate.cogsKop);
      outputs.tax.textContent = rub(data.estimate.taxKop);
      outputs.conservative.textContent = rub(data.estimate.profitWithoutRestorationKop);
      outputs.restored.textContent = rub(data.estimate.profitWithRestorationKop);
      outputs.sales.textContent = String(data.sales);
      outputs.returns.textContent = String(data.returns);
      outputs.quality.textContent = states.map(s =>
        `${stateLabels[s]}: ${data.cogsQuality[s].units} шт. (${rub(data.cogsQuality[s].costKop)})`
      ).join('; ');
      const fragment = document.createDocumentFragment();
      for (const line of data.breakdown) {
        const tr = document.createElement('tr');
        for (const value of [line.sku, String(line.sales), String(line.returns),
          rub(line.unitCostKop), rub(line.soldCostKop), stateLabels[line.costStatus]]) {
          const td = document.createElement('td');
          td.textContent = value;
          tr.appendChild(td);
        }
        fragment.appendChild(tr);
      }
      breakdownRows.replaceChildren(fragment);
      result.hidden = false;
      status.textContent = 'Сверка пройдена. Прибыль и налог предварительные; файлы не сохранялись.';
      form.dispatchEvent?.(new CustomEvent('wb-preview-validated', {detail:{reportId:data.reportId}}));
    } catch {
      if (activeRevision === revision) status.textContent = 'Ошибка соединения или обработки. Результат скрыт.';
    } finally {
      if (activeRevision === revision) { submitButton.disabled = false; controller = null; }
    }
  });
})();
