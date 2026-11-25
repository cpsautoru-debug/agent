CREATE TABLE IF NOT EXISTS office_order_warehouse_routes (
 source TEXT NOT NULL,
 seller_account TEXT NOT NULL,
 store_id TEXT NOT NULL,
 organization_id TEXT NOT NULL,
 store_kind TEXT NOT NULL CHECK (store_kind IN ('manufacturer','retail','marketplace')),
 PRIMARY KEY (source, seller_account)
);
CREATE TABLE IF NOT EXISTS office_order_warehouse_checks (
 order_key TEXT PRIMARY KEY REFERENCES office_order_queue(order_key),
 evidence_json TEXT NOT NULL,
 checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS office_order_warehouse_history (
 id INTEGER PRIMARY KEY,
 order_key TEXT NOT NULL REFERENCES office_order_queue(order_key),
 evidence_json TEXT NOT NULL,
 checked_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS office_order_warehouse_change
AFTER UPDATE OF evidence_json ON office_order_warehouse_checks
WHEN OLD.evidence_json <> NEW.evidence_json
BEGIN
 INSERT INTO office_order_warehouse_history(order_key,evidence_json,checked_at)
 VALUES (OLD.order_key,OLD.evidence_json,OLD.checked_at);
END;
