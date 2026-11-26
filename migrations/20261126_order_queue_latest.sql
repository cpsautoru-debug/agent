CREATE INDEX IF NOT EXISTS office_order_queue_latest
 ON office_order_queue(last_seen_at DESC,order_key);
