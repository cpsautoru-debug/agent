CREATE TABLE IF NOT EXISTS office_order_fulfillment (
 order_key TEXT PRIMARY KEY REFERENCES office_order_queue(order_key),
 source_checked_at TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;
CREATE TABLE IF NOT EXISTS office_order_fulfillment_history (
 id INTEGER PRIMARY KEY,
 order_key TEXT NOT NULL REFERENCES office_order_queue(order_key),
 source_checked_at TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;
CREATE INDEX IF NOT EXISTS office_order_fulfillment_history_order
 ON office_order_fulfillment_history(order_key,id);
CREATE TRIGGER IF NOT EXISTS office_order_fulfillment_history_insert
 AFTER INSERT ON office_order_fulfillment
 BEGIN
  INSERT INTO office_order_fulfillment_history(order_key,source_checked_at,checked_at,result_json)
   VALUES(NEW.order_key,NEW.source_checked_at,NEW.checked_at,NEW.result_json);
 END;
CREATE TRIGGER IF NOT EXISTS office_order_fulfillment_history_update
 AFTER UPDATE ON office_order_fulfillment
 WHEN OLD.source_checked_at<>NEW.source_checked_at OR OLD.result_json<>NEW.result_json
 BEGIN
  INSERT INTO office_order_fulfillment_history(order_key,source_checked_at,checked_at,result_json)
   VALUES(NEW.order_key,NEW.source_checked_at,NEW.checked_at,NEW.result_json);
 END;
