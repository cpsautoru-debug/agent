-- Additive to OZON_FINANCE_DB. Keep existing Ozon/WB/MoySklad tables unchanged.
-- Jobs contain only Yandex report IDs/status, not credentials or raw orders.
CREATE TABLE IF NOT EXISTS yandex_finance_report_jobs (
 month TEXT NOT NULL CHECK (month GLOB '20[0-9][0-9]-[0-1][0-9]'),
 scope TEXT NOT NULL CHECK (scope = 'all' OR length(scope) BETWEEN 1 AND 15),
 report_type TEXT NOT NULL CHECK (report_type IN ('orders','services','payments','realization')),
 report_id TEXT CHECK (report_id IS NULL OR length(report_id) BETWEEN 1 AND 255),
 status TEXT NOT NULL CHECK (status IN ('STARTING','PENDING','PROCESSING','DONE','FAILED')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (month,scope,report_type)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_yandex_finance_report_jobs_status
 ON yandex_finance_report_jobs(status,updated_at);
