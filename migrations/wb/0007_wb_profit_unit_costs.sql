-- Apply ONLY to dedicated staging D1 autosklad63-wb-reports-staging.
-- Additive to 0006. Never touch WB raw rows, Ozon, or published production data.
-- One effective-dated COGS entry per vendor code / start date. Retain
-- history so later cost corrections do not silently rewrite previous months.
CREATE TABLE IF NOT EXISTS wb_profit_unit_costs (
  account_id TEXT NOT NULL,
  vendor_code TEXT NOT NULL CHECK (length(vendor_code) BETWEEN 1 AND 200),
  valid_from TEXT NOT NULL CHECK (
    valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  valid_to TEXT CHECK (
    valid_to IS NULL OR (
      valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND valid_to >= valid_from
    )
  ),
  cost_kopecks INTEGER NOT NULL CHECK (cost_kopecks > 0 AND cost_kopecks <= 100000000),
  status TEXT NOT NULL CHECK (status IN ('preliminary','confirmed')),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 3 AND 250),
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 250),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id,vendor_code,valid_from)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_wb_profit_unit_costs
  ON wb_profit_unit_costs (account_id,vendor_code,valid_from);

-- Immutable audit: COGS rows are append-only. A dated correction uses a
-- later effective-from entry; it cannot rewrite yesterday's cost silently.
CREATE TRIGGER IF NOT EXISTS wb_profit_cost_no_update
BEFORE UPDATE ON wb_profit_unit_costs
BEGIN SELECT RAISE(ABORT,'wb profit unit cost is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wb_profit_cost_no_delete
BEFORE DELETE ON wb_profit_unit_costs
BEGIN SELECT RAISE(ABORT,'wb profit unit cost is immutable'); END;
