CREATE TABLE IF NOT EXISTS ms_sales_directory_snapshots (
 entity_type TEXT PRIMARY KEY CHECK(entity_type IN ('counterparty','saleschannel','organization','store')),
 fetched_at TEXT NOT NULL,
 row_count INTEGER NOT NULL CHECK(row_count>=0),
 items_json TEXT NOT NULL CHECK(json_valid(items_json))
);
