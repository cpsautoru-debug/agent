
export const FINANCE_CATEGORIES = Object.freeze({
  revenue: "Выручка и начисления за товары",
  commission: "Комиссии маркетплейса",
  logistics: "Логистика и доставка",
  storage: "Хранение и обработка",
  advertising: "Реклама и продвижение",
  returns: "Возвраты и обратная логистика",
  compensation: "Компенсации и корректировки",
  other: "Прочие начисления и удержания",
  unknown: "Не классифицировано"
});

export function validateFinanceTypes(types) {
  if (!Array.isArray(types)) {
    throw new TypeError("Finance types must be an array");
  }

  return types.map((type) => ({
    id: type.id,
    name: type.name,
    description: type.description ?? "",
    category: "unknown",
    reviewed: false
  }));
}

export function createFinanceSummary() {
  return {
    currency: "RUB",
    revenue: null,
    commission: null,
    logistics: null,
    storage: null,
    advertising: null,
    returns: null,
    compensation: null,
    other: null,
    costOfGoods: null,
    contributionMargin: null,
    netProfit: null,
    reconciled: false
  };
}
