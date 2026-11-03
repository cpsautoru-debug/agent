import assert from "node:assert/strict";
import test from "node:test";
import { importModule } from "./load-module.mjs";

const { classifyOperation, classifyScope, CATEGORY, SCOPE } = await importModule(
  import.meta.url,
  "../../functions/api/ozon/xlsx-classifier.js"
);

function op(serviceName, extra = {}) {
  return { serviceName, ...extra };
}

test("classifyOperation recognizes each documented category by keyword", () => {
  assert.equal(classifyOperation(op("Реализация товара")), CATEGORY.SALE);
  assert.equal(classifyOperation(op("Обработка возврата, отмены, невыкупа")), CATEGORY.RETURN);
  assert.equal(classifyOperation(op("Комиссия за продажу")), CATEGORY.OZON_COMMISSION);
  assert.equal(classifyOperation(op("Логистика, доставка до покупателя")), CATEGORY.LOGISTICS);
  assert.equal(classifyOperation(op("Эквайринг")), CATEGORY.ACQUIRING);
  assert.equal(classifyOperation(op("Продвижение за заказ")), CATEGORY.PROMOTION_PER_ORDER);
  assert.equal(classifyOperation(op("Реклама за клики")), CATEGORY.ADS_CPC);
  assert.equal(classifyOperation(op("Premium Plus")), CATEGORY.SUBSCRIPTION);
  assert.equal(classifyOperation(op("Аналитика Plus")), CATEGORY.SUBSCRIPTION);
  assert.equal(classifyOperation(op("Размещение на складе")), CATEGORY.WAREHOUSE_SERVICES);
  assert.equal(classifyOperation(op("Штраф за нарушение")), CATEGORY.OTHER_DEDUCTION);
});

test("classifyOperation leaves genuinely unrecognized service names as UNKNOWN", () => {
  assert.equal(
    classifyOperation(op("Совершенно новая услуга, которой нет в правилах")),
    CATEGORY.UNKNOWN
  );
  assert.equal(classifyOperation(op("")), CATEGORY.UNKNOWN);
  assert.equal(classifyOperation({}), CATEGORY.UNKNOWN);
});

test("classifyOperation does not use amount to decide the category", () => {
  const a = classifyOperation(op("Логистика", { amountKopecks: -100 }));
  const b = classifyOperation(op("Логистика", { amountKopecks: 100 }));
  assert.equal(a, b);
});

test("classifyScope distinguishes SKU, order and shop-wide expenses", () => {
  assert.equal(
    classifyScope({ sku: "SKU-1", postingNumber: "P-1" }),
    SCOPE.SKU
  );
  assert.equal(
    classifyScope({ sku: null, postingNumber: "P-1" }),
    SCOPE.ORDER
  );
  assert.equal(classifyScope({ sku: null, postingNumber: null }), SCOPE.SHOP);
});

test("31 October known operations classify without hardcoding their amounts", () => {
  // Это общая проверка алгоритма классификации по формулировке услуги;
  // конкретные суммы 31.10.2026 (28000, 6990, 3890.40, 716.33, 704.50,
  // 163.07, 121.35 ₽) не встроены в правила классификатора — они
  // подтверждаются только на реальном файле отчёта.
  const knownOperations = [
    { serviceName: "Аналитика Plus", expected: CATEGORY.SUBSCRIPTION },
    { serviceName: "Premium Plus", expected: CATEGORY.SUBSCRIPTION },
    { serviceName: "Продвижение за заказ", expected: CATEGORY.PROMOTION_PER_ORDER },
    { serviceName: "Реклама за клики", expected: CATEGORY.ADS_CPC },
    { serviceName: "Размещение на складе", expected: CATEGORY.WAREHOUSE_SERVICES }
  ];
  for (const { serviceName, expected } of knownOperations) {
    assert.equal(classifyOperation(op(serviceName)), expected, serviceName);
  }
});

// ---------------------------------------------------------------------
// Регрессионные тесты по реальному файлу
// "Отчет по начислениям_31.10.2026-02.11.2026.xlsx" (проверено вручную
// 03.11.2026). Названия типов ниже — точные формулировки из реального
// отчёта (21 уникальный тип), не синтетика.
// ---------------------------------------------------------------------

test("all 21 real accrual types from the 31.10-02.11.2026 report are classified as expected", () => {
  const cases = [
    { serviceName: "Аналитика Plus", serviceGroup: "Озон Технологии", expected: CATEGORY.SUBSCRIPTION },
    { serviceName: "Подписка Premium Plus", serviceGroup: "Продвижение и реклама", expected: CATEGORY.SUBSCRIPTION },
    { serviceName: "Оплата за клик", serviceGroup: "Продвижение и реклама", expected: CATEGORY.ADS_CPC },
    { serviceName: "Продвижение с оплатой за заказ", serviceGroup: "Продвижение и реклама", expected: CATEGORY.PROMOTION_PER_ORDER },
    { serviceName: "Размещение на складе", serviceGroup: "Услуги FBO", expected: CATEGORY.WAREHOUSE_SERVICES },
    { serviceName: "Логистика", serviceGroup: "Услуги доставки", expected: CATEGORY.LOGISTICS },
    { serviceName: "Обратная логистика", serviceGroup: "Услуги доставки", expected: CATEGORY.LOGISTICS },
    { serviceName: "Доставка до места выдачи", serviceGroup: "Услуги партнёров", expected: CATEGORY.LOGISTICS },
    { serviceName: "Доставка до места выдачи силами Ozon", serviceGroup: "Услуги доставки", expected: CATEGORY.LOGISTICS },
    { serviceName: "Обработка отправления Drop-off партнёрами (ПВЗ)", serviceGroup: "Услуги партнёров", expected: CATEGORY.LOGISTICS },
    { serviceName: "Эквайринг", serviceGroup: "Услуги партнёров", expected: CATEGORY.ACQUIRING },
    { serviceName: "Выручка", serviceGroup: "Продажи", expected: CATEGORY.SALE },
    { serviceName: "Вознаграждение за продажу", serviceGroup: "Вознаграждение Ozon", expected: CATEGORY.OZON_COMMISSION },
    { serviceName: "Возврат выручки", serviceGroup: "Возвраты", expected: CATEGORY.RETURN },
    { serviceName: "Обработка возвратов, отмен и невыкупов партнёрами", serviceGroup: "Услуги партнёров", expected: CATEGORY.RETURN },
    { serviceName: "Обеспечение материалами для упаковки товара", serviceGroup: "Другие услуги и штрафы", expected: CATEGORY.OTHER_DEDUCTION },
    { serviceName: "Упаковка товара партнёрами", serviceGroup: "Услуги партнёров", expected: CATEGORY.UNKNOWN }
  ];
  for (const { serviceName, serviceGroup, expected } of cases) {
    assert.equal(
      classifyOperation(op(serviceName, { serviceGroup })),
      expected,
      `${serviceName} (${serviceGroup})`
    );
  }
});

test("REGRESSION: 'Возврат вознаграждения' is OZON_COMMISSION, not RETURN, despite containing the word 'возврат'", () => {
  // В реальном отчёте это разворот ранее удержанной комиссии Ozon при
  // возврате товара (группа "Вознаграждение Ozon"), а не возврат
  // товара/выручки сам по себе.
  assert.equal(
    classifyOperation(op("Возврат вознаграждения", { serviceGroup: "Вознаграждение Ozon" })),
    CATEGORY.OZON_COMMISSION
  );
});

test("REGRESSION: 'нерекомендованный слот' is OTHER_DEDUCTION (штраф), not LOGISTICS as previously assumed", () => {
  // В предыдущей версии классификатора (до проверки реального файла)
  // слово "слот" ошибочно относило эту операцию к LOGISTICS. Реальный
  // отчёт помещает её в группу "Другие услуги и штрафы" — это штраф,
  // а не логистическая услуга.
  assert.equal(
    classifyOperation(op("Отгрузка в нерекомендованный слот", {
      serviceGroup: "Другие услуги и штрафы"
    })),
    CATEGORY.OTHER_DEDUCTION
  );
  assert.notEqual(
    classifyOperation(op("Отгрузка в нерекомендованный слот", {
      serviceGroup: "Другие услуги и штрафы"
    })),
    CATEGORY.LOGISTICS
  );
});

test("the same real service name is classified differently per verified official group (Баллы за скидки / Программы партнёров)", () => {
  // "Баллы за скидки" и "Программы партнёров" в реальном отчёте
  // встречаются как в группе "Продажи", так и в группе "Возвраты" —
  // классификатор обязан использовать группу конкретной строки, а не
  // одно значение на весь тип начисления.
  assert.equal(
    classifyOperation(op("Баллы за скидки", { serviceGroup: "Продажи" })),
    CATEGORY.SALE
  );
  assert.equal(
    classifyOperation(op("Баллы за скидки", { serviceGroup: "Возвраты" })),
    CATEGORY.RETURN
  );
  assert.equal(
    classifyOperation(op("Программы партнёров", { serviceGroup: "Продажи" })),
    CATEGORY.SALE
  );
  assert.equal(
    classifyOperation(op("Программы партнёров", { serviceGroup: "Возвраты" })),
    CATEGORY.RETURN
  );
});

test("an unrecognized service name with no group fallback stays UNKNOWN even with a group present", () => {
  assert.equal(
    classifyOperation(op("Совершенно новая услуга", { serviceGroup: "Услуги партнёров" })),
    CATEGORY.UNKNOWN
  );
});

test("classifyScope assigns ORDER to PROMOTION_PER_ORDER operations even without an sku or posting number column", () => {
  // Реальный отчёт не содержит колонки "Номер отправления"; для
  // "Продвижение с оплатой за заказ" нет и артикула — это ожидаемо
  // (комиссия платится за заказ в целом), и это единственная
  // категория, для которой отсутствие обеих колонок не означает
  // "общий расход магазина".
  const operation = { sku: null, postingNumber: null };
  assert.equal(
    classifyScope(operation, CATEGORY.PROMOTION_PER_ORDER),
    SCOPE.ORDER
  );
  assert.equal(
    classifyScope(operation, CATEGORY.ADS_CPC),
    SCOPE.SHOP
  );
  assert.equal(
    classifyScope(operation, CATEGORY.SUBSCRIPTION),
    SCOPE.SHOP
  );
});
