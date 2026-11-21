-- Apply ONLY to the Pages staging D1 bound as OZON_FINANCE_DB.
-- Additive mapping registry: no WB/Ozon source financial rows or costs changed.
-- A link expresses a HUMAN-VERIFIED identical physical product, NOT shared COGS.
CREATE TABLE IF NOT EXISTS office_finance_product_links (
  wb_vendor_code TEXT NOT NULL PRIMARY KEY
    CHECK (length(wb_vendor_code) BETWEEN 1 AND 200),
  ozon_sku TEXT NOT NULL UNIQUE
    CHECK (length(ozon_sku) BETWEEN 1 AND 150),
  ozon_seller_article TEXT NOT NULL
    CHECK (length(ozon_seller_article) BETWEEN 1 AND 250),
  model_name TEXT NOT NULL
    CHECK (length(model_name) BETWEEN 1 AND 100),
  verified_from TEXT NOT NULL
    CHECK (verified_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  evidence TEXT NOT NULL
    CHECK (length(evidence) BETWEEN 15 AND 500),
  actor TEXT NOT NULL
    CHECK (length(actor) BETWEEN 1 AND 250),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX IF NOT EXISTS idx_office_finance_links_ozon
  ON office_finance_product_links (ozon_sku);
CREATE TRIGGER IF NOT EXISTS office_finance_product_links_no_update
BEFORE UPDATE ON office_finance_product_links
BEGIN SELECT RAISE(ABORT,'product identity links are immutable'); END;
CREATE TRIGGER IF NOT EXISTS office_finance_product_links_no_delete
BEFORE DELETE ON office_finance_product_links
BEGIN SELECT RAISE(ABORT,'product identity links are immutable'); END;
