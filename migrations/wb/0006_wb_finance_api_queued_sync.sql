-- Staging only: autosklad63-wb-reports-staging (e3525cac-f516-4750-957f-44b196e9fb5e).
-- Does not touch wb_saved_xlsx_reports, Ozon tables, or existing API objects.
CREATE TABLE IF NOT EXISTS wb_finance_api_runtime (
  account_id TEXT PRIMARY KEY,
  last_list_day TEXT NOT NULL DEFAULT '',
  list_offset INTEGER NOT NULL DEFAULT 0 CHECK (list_offset >= 0),
  last_request_ms INTEGER NOT NULL DEFAULT 0,
  lock_until_ms INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'never_run',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS wb_finance_api_reports (
  account_id TEXT NOT NULL,
  report_id TEXT NOT NULL CHECK (length(report_id) BETWEEN 1 AND 20),
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  report_type INTEGER NOT NULL CHECK (report_type IN (1, 2)),
  bank_payment_kop INTEGER NOT NULL,
  cursor_rrd_id TEXT NOT NULL DEFAULT '0',
  row_count INTEGER NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  returns_count INTEGER NOT NULL DEFAULT 0,
  api_calculated_payment_kop INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paging','complete','mismatch','conflict','failed')),
  error_code TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, report_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_wb_finance_api_pending
  ON wb_finance_api_reports (account_id, status, date_from, report_id);

CREATE TABLE IF NOT EXISTS wb_finance_api_rows (
  account_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  rrd_id TEXT NOT NULL,
  seller_oper_name TEXT NOT NULL,
  vendor_code TEXT,
  quantity INTEGER NOT NULL,
  for_pay_kop INTEGER NOT NULL,
  delivery_service_kop INTEGER NOT NULL,
  paid_storage_kop INTEGER NOT NULL,
  deduction_kop INTEGER NOT NULL,
  penalty_kop INTEGER NOT NULL,
  additional_payment_kop INTEGER NOT NULL,
  paid_acceptance_kop INTEGER NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  PRIMARY KEY (account_id, report_id, rrd_id),
  FOREIGN KEY (account_id, report_id) REFERENCES wb_finance_api_reports(account_id, report_id)
) STRICT;
