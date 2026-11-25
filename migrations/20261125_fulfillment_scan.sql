CREATE TABLE IF NOT EXISTS office_fulfillment_scan (
 scope TEXT PRIMARY KEY,
 generation TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 lease_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS office_fulfillment_scan_page (
 scope TEXT NOT NULL REFERENCES office_fulfillment_scan(scope) ON DELETE CASCADE,
 generation TEXT NOT NULL,
 request_key TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 PRIMARY KEY(scope,generation,request_key)
) STRICT;
