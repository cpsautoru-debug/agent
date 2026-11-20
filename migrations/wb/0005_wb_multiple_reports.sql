-- Approved only for autosklad63-wb-reports-staging.
-- Retain every existing column/constraint except the pilot-only report_id CHECK.
CREATE TABLE wb_saved_xlsx_reports_multi (
 account_id TEXT NOT NULL,
 report_id TEXT NOT NULL,
 source TEXT NOT NULL,
 fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
 snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
 snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
 saved_by TEXT NOT NULL,
 PRIMARY KEY (account_id, report_id)
) STRICT;
INSERT INTO wb_saved_xlsx_reports_multi SELECT * FROM wb_saved_xlsx_reports;
DROP TABLE wb_saved_xlsx_reports;
ALTER TABLE wb_saved_xlsx_reports_multi RENAME TO wb_saved_xlsx_reports;
