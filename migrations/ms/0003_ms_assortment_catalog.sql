CREATE TABLE IF NOT EXISTS ms_assortment_scan (
 generation TEXT PRIMARY KEY, started_at TEXT NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0,
 total INTEGER, status TEXT NOT NULL CHECK(status IN ('loading','complete','abandoned'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ms_assortment_one_loading ON ms_assortment_scan(status) WHERE status='loading';
CREATE TABLE IF NOT EXISTS ms_assortment_items (
 generation TEXT NOT NULL REFERENCES ms_assortment_scan(generation), item_id TEXT NOT NULL,
 item_type TEXT NOT NULL, article TEXT, code TEXT, item_json TEXT NOT NULL CHECK(json_valid(item_json)),
 PRIMARY KEY(generation,item_id)
);
CREATE INDEX IF NOT EXISTS ms_assortment_article ON ms_assortment_items(generation,article);
CREATE INDEX IF NOT EXISTS ms_assortment_code ON ms_assortment_items(generation,code);
CREATE TABLE IF NOT EXISTS ms_assortment_current (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation TEXT NOT NULL REFERENCES ms_assortment_scan(generation),
 completed_at TEXT NOT NULL, row_count INTEGER NOT NULL
);
