-- LOCAL/ISOLATED TEST D1 ONLY. Do not apply to Ozon or production.
-- Separate from wb_report_snapshots (synthetic DEMO).
CREATE TABLE wb_saved_xlsx_reports (
 account_id TEXT NOT NULL,
 report_id TEXT NOT NULL CHECK (report_id = '865265818'),
 source TEXT NOT NULL,
 fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
 snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
 snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
 saved_by TEXT NOT NULL,
 PRIMARY KEY (account_id, report_id)
) STRICT;
