// Классификатор статей операций официального отчёта Ozon.
//
// Правила основаны на (1) терминологии "Тип начисления" реального
// отчёта "Отчет по начислениям_31.10.2026-02.11.2026.xlsx" (все 21
// уникальных наименования сверены вручную с этим файлом) и (2),
// как дополнительный проверенный признак официального отчёта — на
// колонке "Группа услуг" для тех типов, что сама официальная группа
// однозначно называет так же, как категория задачи ("Продажи" →
// продажи, "Возвраты" → возвраты, "Вознаграждение Ozon" → комиссия
// Ozon, "Другие услуги и штрафы" → прочие удержания, "Услуги FBO" →
// складские услуги). Группа НЕ используется как единственный сигнал
// там, где она объединяет разнородные типы (например, "Продвижение и
// реклама" включает и подписки, и рекламу за клики, и продвижение за
// заказ — здесь решает только название типа).
//
// Одинаковые суммы НЕ считаются доказательством классификации или
// совпадения операций. Операция, для которой ни одно правило (по
// названию типа и/или по группе) не сработало, остаётся UNKNOWN и
// требует ручной проверки — её нельзя тихо отнести к "прочим
// удержаниям".

export const CATEGORY = Object.freeze({
  SALE: "SALE",
  RETURN: "RETURN",
  OZON_COMMISSION: "OZON_COMMISSION",
  LOGISTICS: "LOGISTICS",
  ACQUIRING: "ACQUIRING",
  PROMOTION_PER_ORDER: "PROMOTION_PER_ORDER",
  ADS_CPC: "ADS_CPC",
  SUBSCRIPTION: "SUBSCRIPTION",
  WAREHOUSE_SERVICES: "WAREHOUSE_SERVICES",
  OTHER_DEDUCTION: "OTHER_DEDUCTION",
  UNKNOWN: "UNKNOWN"
});

export const SCOPE = Object.freeze({
  SKU: "sku",
  ORDER: "order",
  SHOP: "shop"
});

// Порядок важен: более специфичные правила по названию типа проверяются
// раньше. Правило комиссии Ozon (ключевое слово "вознаграждени")
// намеренно стоит раньше правила возвратов, иначе "Возврат
// вознаграждения" (реальный тип начисления, группа "Вознаграждение
// Ozon") ошибочно попал бы в категорию "возвраты" вместо "комиссия
// Ozon" только из-за слова "возврат" в названии.
const RULES = [
  { category: CATEGORY.ACQUIRING, test: name => /эквайринг/.test(name) },
  {
    category: CATEGORY.SUBSCRIPTION,
    test: name => /premium|подписк|аналитика\s*plus/.test(name)
  },
  { category: CATEGORY.ADS_CPC, test: name => /клик/.test(name) },
  {
    category: CATEGORY.PROMOTION_PER_ORDER,
    test: name => /продвижен/.test(name) && /заказ/.test(name)
  },
  { category: CATEGORY.WAREHOUSE_SERVICES, test: name => /склад|хранени/.test(name) },
  {
    category: CATEGORY.LOGISTICS,
    // "обработка отправления" — подтверждённая реальная формулировка
    // ("Обработка отправления Drop-off партнёрами (ПВЗ)"), не ключевое
    // слово "слот" — наличие "нерекомендованного слота" в логистике
    // было непроверенным предположением и опровергнуто реальным
    // файлом (там группа услуг — "Другие услуги и штрафы", см. ниже).
    test: name => /логист|доставк|магистрал|обработка\s+отправлени/.test(name)
  },
  { category: CATEGORY.OZON_COMMISSION, test: name => /комисси|вознаграждени/.test(name) },
  { category: CATEGORY.RETURN, test: name => /возврат|невыкуп|отмен/.test(name) },
  {
    category: CATEGORY.SALE,
    test: name => /реализац|продажа товара|начислени.* за (единицу )?товар|выручк/.test(name)
  },
  { category: CATEGORY.OTHER_DEDUCTION, test: name => /штраф|утилизац/.test(name) }
];

// Группы, для которых официальное название группы в отчёте буквально
// совпадает по смыслу с одной из 11 категорий задачи — используются
// только как запасной сигнал, когда ни одно правило по названию типа
// не сработало.
const GROUP_FALLBACK = {
  "продажи": CATEGORY.SALE,
  "возвраты": CATEGORY.RETURN,
  "вознаграждение ozon": CATEGORY.OZON_COMMISSION,
  "другие услуги и штрафы": CATEGORY.OTHER_DEDUCTION,
  "услуги fbo": CATEGORY.WAREHOUSE_SERVICES
};

function normalizeGroup(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function classifyOperation(operation) {
  const name = typeof operation?.serviceName === "string"
    ? operation.serviceName.trim().toLowerCase()
    : "";
  if (name) {
    for (const rule of RULES) {
      if (rule.test(name)) return rule.category;
    }
  }

  const group = normalizeGroup(operation?.serviceGroup);
  if (group && GROUP_FALLBACK[group]) return GROUP_FALLBACK[group];

  return CATEGORY.UNKNOWN;
}

// Расход/начисление относится к конкретному SKU, если указан артикул;
// иначе к заказу, если указан номер отправления, либо если категория
// сама по себе однозначно привязана к заказу ("продвижение за заказ" —
// по определению оплачивается за конкретный заказ, что подтверждено
// названием типа в реальном отчёте, даже когда в файле нет отдельной
// колонки с номером отправления для этой строки); иначе — общий
// расход магазина (не привязан ни к товару, ни к заказу).
export function classifyScope(operation, category) {
  if (operation?.sku) return SCOPE.SKU;
  if (operation?.postingNumber) return SCOPE.ORDER;
  if (category === CATEGORY.PROMOTION_PER_ORDER) return SCOPE.ORDER;
  return SCOPE.SHOP;
}

export const CATEGORY_LABELS_RU = Object.freeze({
  [CATEGORY.SALE]: "Продажи",
  [CATEGORY.RETURN]: "Возвраты",
  [CATEGORY.OZON_COMMISSION]: "Комиссия Ozon",
  [CATEGORY.LOGISTICS]: "Логистика",
  [CATEGORY.ACQUIRING]: "Эквайринг",
  [CATEGORY.PROMOTION_PER_ORDER]: "Продвижение за заказ",
  [CATEGORY.ADS_CPC]: "Реклама за клики",
  [CATEGORY.SUBSCRIPTION]: "Подписки",
  [CATEGORY.WAREHOUSE_SERVICES]: "Складские услуги",
  [CATEGORY.OTHER_DEDUCTION]: "Прочие удержания",
  [CATEGORY.UNKNOWN]: "Неопределённые операции"
});
