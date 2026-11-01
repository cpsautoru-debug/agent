CREATE TABLE IF NOT EXISTS ozon_api_accruals (
  accrual_id TEXT PRIMARY KEY NOT NULL,
  operation_date TEXT NOT NULL,
  period TEXT NOT NULL,
  accrued_category TEXT NOT NULL,
  unit_number TEXT,
  total_kopecks INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'RUB'),
  source TEXT NOT NULL DEFAULT 'ozon_seller_api'
    CHECK (source = 'ozon_seller_api'),
  reconciled INTEGER NOT NULL DEFAULT 0
    CHECK (reconciled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ozon_api_accruals_date
  ON ozon_api_accruals (source, operation_date);

CREATE INDEX IF NOT EXISTS idx_ozon_api_accruals_period
  ON ozon_api_accruals (source, period);

CREATE TABLE IF NOT EXISTS ozon_api_accrual_components (
  component_id TEXT PRIMARY KEY NOT NULL,
  accrual_id TEXT NOT NULL
    REFERENCES ozon_api_accruals (accrual_id)
    ON DELETE CASCADE,
  sku TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  amount_kopecks INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ozon_api_accrual_components_sku
  ON ozon_api_accrual_components (sku, type_id);

CREATE TABLE IF NOT EXISTS ozon_api_accrual_types (
  type_id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ozon_api_sync_state (
  sync_date TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL DEFAULT 'ozon_seller_api'
    CHECK (source = 'ozon_seller_api'),
  status TEXT NOT NULL
    CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  last_id TEXT NOT NULL DEFAULT '',
  page_count INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  page_complete INTEGER NOT NULL DEFAULT 0
    CHECK (page_complete IN (0, 1)),
  reconciled INTEGER NOT NULL DEFAULT 0
    CHECK (reconciled IN (0, 1)),
  last_error_code TEXT,
  last_started_at TEXT NOT NULL,
  last_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ozon_api_sync_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL DEFAULT 'ozon_seller_api'
    CHECK (source = 'ozon_seller_api'),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'complete', 'partial', 'failed', 'skipped')),
  page_count INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  types_synced INTEGER NOT NULL DEFAULT 0
    CHECK (types_synced IN (0, 1)),
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ozon_api_sync_runs_started
  ON ozon_api_sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS ozon_api_sync_lock (
  lock_id INTEGER PRIMARY KEY NOT NULL CHECK (lock_id = 1),
  lock_token TEXT,
  locked_until TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);
