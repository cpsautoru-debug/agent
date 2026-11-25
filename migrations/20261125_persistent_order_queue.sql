-- Staging-only operational mirror; accounting remains in MoySklad.
CREATE TABLE IF NOT EXISTS office_order_queue (
 order_key TEXT PRIMARY KEY,
 source TEXT NOT NULL CHECK(source IN ('ozon','ozon_fbo','wb','yandex','avito','plamya','dealer_ruslan','dealer_irina')),
 account TEXT NOT NULL,
 external_id TEXT NOT NULL,
 source_status TEXT NOT NULL,
 production_disposition TEXT NOT NULL CHECK(production_disposition IN ('candidate_needs_inventory','not_for_sewing','unverified')),
 items_json TEXT NOT NULL CHECK(json_valid(items_json)),
 ms_customerorder_id TEXT,
 workflow_status TEXT NOT NULL DEFAULT 'unverified' CHECK(workflow_status='unverified'),
 source_checked_at TEXT NOT NULL,
 first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 source_complete INTEGER NOT NULL DEFAULT 1 CHECK(source_complete=1),
 UNIQUE(source,account,external_id)
) STRICT;
CREATE INDEX IF NOT EXISTS office_order_queue_source ON office_order_queue(source,last_seen_at);
CREATE TABLE IF NOT EXISTS office_order_queue_sync (
 source TEXT PRIMARY KEY,
 last_success_at TEXT NOT NULL,
 coverage TEXT NOT NULL,
 rows_seen INTEGER NOT NULL CHECK(rows_seen>=0),
 note TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS office_order_queue_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_key TEXT NOT NULL,
 event_kind TEXT NOT NULL CHECK(event_kind IN ('first_seen','source_status_changed')),
 from_status TEXT,
 to_status TEXT NOT NULL,
 happened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_key) REFERENCES office_order_queue(order_key)
) STRICT;
CREATE INDEX IF NOT EXISTS office_order_queue_events_key ON office_order_queue_events(order_key,id);
CREATE TRIGGER IF NOT EXISTS office_order_queue_first_seen
AFTER INSERT ON office_order_queue BEGIN
 INSERT INTO office_order_queue_events(order_key,event_kind,from_status,to_status)
 VALUES(NEW.order_key,'first_seen',NULL,NEW.source_status);
END;
CREATE TRIGGER IF NOT EXISTS office_order_queue_source_status_changed
AFTER UPDATE OF source_status ON office_order_queue
WHEN OLD.source_status<>NEW.source_status BEGIN
 INSERT INTO office_order_queue_events(order_key,event_kind,from_status,to_status)
 VALUES(NEW.order_key,'source_status_changed',OLD.source_status,NEW.source_status);
END;
