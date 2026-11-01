CREATE TABLE IF NOT EXISTS ozon_api_reconciliation_audit (
  audit_id TEXT PRIMARY KEY NOT NULL,
  operation_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'ozon_seller_api'),
  source_report TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (
    length(source_sha256) = 64
    AND source_sha256 NOT GLOB '*[^0-9A-Fa-f]*'
  ),
  method TEXT NOT NULL,
  expected_count INTEGER NOT NULL CHECK (expected_count > 0),
  expected_total_kopecks INTEGER NOT NULL,
  report_positive_kopecks INTEGER NOT NULL,
  report_negative_kopecks INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  actual_total_kopecks INTEGER NOT NULL,
  api_positive_kopecks INTEGER NOT NULL,
  api_negative_kopecks INTEGER NOT NULL,
  net_status TEXT NOT NULL CHECK (net_status IN ('verified', 'unverified')),
  detail_status TEXT NOT NULL
    CHECK (detail_status IN ('verified', 'unverified')),
  detail_reason TEXT,
  updated_count INTEGER NOT NULL,
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    net_status = 'unverified'
    OR (
      actual_count = expected_count
      AND actual_total_kopecks = expected_total_kopecks
    )
  ),
  CHECK (
    (
      detail_status = 'verified'
      AND net_status = 'verified'
      AND detail_reason IS NULL
      AND updated_count = expected_count
    )
    OR (
      detail_status = 'unverified'
      AND detail_reason IS NOT NULL
      AND updated_count = 0
    )
  )
);

CREATE TABLE IF NOT EXISTS ozon_api_reconciliation_audit_rows (
  audit_id TEXT NOT NULL
    REFERENCES ozon_api_reconciliation_audit(audit_id),
  accrual_id TEXT NOT NULL
    REFERENCES ozon_api_accruals(accrual_id),
  operation_date TEXT NOT NULL,
  unit_number TEXT,
  accrued_category TEXT NOT NULL,
  total_kopecks INTEGER NOT NULL,
  verification_level TEXT NOT NULL CHECK (
    verification_level IN ('net', 'detail')
  ),
  reconciled_before INTEGER NOT NULL CHECK (reconciled_before IN (0, 1)),
  reconciled_after INTEGER NOT NULL CHECK (reconciled_after IN (0, 1)),
  CHECK (reconciled_after >= reconciled_before),
  PRIMARY KEY (audit_id, accrual_id)
);

CREATE TABLE IF NOT EXISTS ozon_api_accrual_discrepancies (
  discrepancy_id TEXT PRIMARY KEY NOT NULL,
  accrual_id TEXT NOT NULL
    REFERENCES ozon_api_accruals(accrual_id),
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  previous_date TEXT NOT NULL,
  previous_unit_number TEXT,
  previous_category TEXT NOT NULL,
  previous_total_kopecks INTEGER NOT NULL,
  observed_date TEXT NOT NULL,
  observed_unit_number TEXT,
  observed_category TEXT NOT NULL,
  observed_total_kopecks INTEGER NOT NULL,
  previous_components_hash TEXT NOT NULL CHECK (length(previous_components_hash) = 64),
  observed_components_hash TEXT NOT NULL CHECK (length(observed_components_hash) = 64),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  UNIQUE (accrual_id, observed_date, observed_unit_number,
          observed_category, observed_total_kopecks)
);

CREATE INDEX IF NOT EXISTS idx_ozon_api_accrual_discrepancies_status
  ON ozon_api_accrual_discrepancies(status, detected_at DESC);

CREATE TABLE IF NOT EXISTS ozon_api_backfill_state (
  job_id TEXT PRIMARY KEY NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  next_date TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('prepared', 'running', 'complete', 'paused', 'failed')),
  max_dates_per_run INTEGER NOT NULL
    CHECK (max_dates_per_run BETWEEN 1 AND 3),
  last_run_id TEXT,
  last_error_code TEXT,
  lock_token TEXT,
  locked_until TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (period_start <= next_date AND next_date <= period_end)
);

CREATE TABLE IF NOT EXISTS ozon_api_backfill_runs (
  backfill_run_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES ozon_api_backfill_state(job_id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'complete', 'partial', 'failed', 'skipped')),
  pages INTEGER NOT NULL DEFAULT 0,
  records INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
