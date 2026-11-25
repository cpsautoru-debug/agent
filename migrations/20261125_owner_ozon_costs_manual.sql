-- Autosklad63 | D1 ozon-finance | owner unit costs | 2026-11-25
-- Run in Cloudflare D1 SQL console ONLY against autosklad63-ozon-finance.
-- Inserts 3 previously unregistered Ozon SKU costs based on verified seller
-- articles and owner-approved product-family costs. No existing row is edited.
-- In particular SKU 5023073005 existing historical 4700 RUB is untouched.
INSERT INTO ozon_cost_entries
  (sku,seller_article,model,cost_kopecks,status,source,updated_at)
SELECT '4866138075','искра с оарнжевой поддержкой','Lada Iskra',
  469700,'confirmed','OWNER_MODEL_COST_SKU_REVIEW_2026-11-25',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM ozon_cost_entries WHERE sku='4866138075');

INSERT INTO ozon_cost_entries
  (sku,seller_article,model,cost_kopecks,status,source,updated_at)
SELECT '5577302430','самара с белой поддержкой','Lada Samara',
  320000,'confirmed','OWNER_MODEL_COST_SKU_REVIEW_2026-11-25',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM ozon_cost_entries WHERE sku='5577302430');

INSERT INTO ozon_cost_entries
  (sku,seller_article,model,cost_kopecks,status,source,updated_at)
SELECT '3834045718','чехлы-приора-с серыми сотами','Lada Priora',
  319900,'confirmed','OWNER_MODEL_COST_SKU_REVIEW_2026-11-25',CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM ozon_cost_entries WHERE sku='3834045718');

SELECT sku, seller_article, model, cost_kopecks, status, source
FROM ozon_cost_entries
WHERE sku IN ('4866138075','5577302430','3834045718')
ORDER BY sku;
