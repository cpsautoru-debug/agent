
import { checkFinanceTypes } from "./ozon-finance-types.mjs";

export async function inspectFinanceCategories() {
  const result = await checkFinanceTypes();

  if (!result.connected || !result.complete) {
    return {
      connected: false,
      complete: false,
      httpStatus: result.httpStatus ?? null
    };
  }

  const types = result.types ?? [];

  const categories = {
    revenue: [],
    commission: [],
    logistics: [],
    returns: [],
    other: [],
    unclassified: []
  };

  // Пока нет проверенного соответствия type_id и
  // экономических категорий, ничего не классифицируем.
  for (const type of types) {
    categories.unclassified.push({
      id: type.id,
      name: type.name,
      description: type.description
    });
  }

  return {
    connected: true,
    complete: true,
    totalTypes: types.length,
    classified: 0,
    unclassified: categories.unclassified.length,
    categories
  };
}
