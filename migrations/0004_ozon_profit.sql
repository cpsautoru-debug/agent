-- Additive test-only profit ledger. No changes to API accruals or reconciliation.
CREATE TABLE IF NOT EXISTS ozon_profit_target (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  database_id TEXT NOT NULL CHECK(database_id = 'ce9dd331-929d-4c3e-9073-368de3346bc9')
);
INSERT OR IGNORE INTO ozon_profit_target VALUES(1, 'ce9dd331-929d-4c3e-9073-368de3346bc9');
CREATE TABLE IF NOT EXISTS ozon_profit_state (
  document_key TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  version INTEGER NOT NULL CHECK(version > 0),
  actor TEXT NOT NULL,
  change_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ozon_profit_audit (
  change_id TEXT PRIMARY KEY NOT NULL,
  document_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_key,version)
);
CREATE TRIGGER IF NOT EXISTS ozon_profit_version_guard BEFORE UPDATE ON ozon_profit_state
WHEN NEW.version != OLD.version + 1 OR NEW.document_key != OLD.document_key
BEGIN SELECT RAISE(ABORT, 'profit version conflict'); END;
CREATE TRIGGER IF NOT EXISTS ozon_profit_audit_insert AFTER INSERT ON ozon_profit_state
BEGIN
 INSERT INTO ozon_profit_audit(change_id,document_key,version,actor,before_json,after_json)
 VALUES(NEW.change_id,NEW.document_key,NEW.version,NEW.actor,NULL,NEW.payload_json);
END;
CREATE TRIGGER IF NOT EXISTS ozon_profit_audit_update AFTER UPDATE ON ozon_profit_state
BEGIN
 INSERT INTO ozon_profit_audit(change_id,document_key,version,actor,before_json,after_json)
 VALUES(NEW.change_id,NEW.document_key,NEW.version,NEW.actor,OLD.payload_json,NEW.payload_json);
END;
CREATE TRIGGER IF NOT EXISTS ozon_profit_audit_no_update BEFORE UPDATE ON ozon_profit_audit
BEGIN SELECT RAISE(ABORT, 'profit audit immutable'); END;
CREATE TRIGGER IF NOT EXISTS ozon_profit_audit_no_delete BEFORE DELETE ON ozon_profit_audit
BEGIN SELECT RAISE(ABORT, 'profit audit immutable'); END;
CREATE TRIGGER IF NOT EXISTS ozon_profit_state_no_delete BEFORE DELETE ON ozon_profit_state
BEGIN SELECT RAISE(ABORT, 'profit state immutable; use a versioned correction'); END;
