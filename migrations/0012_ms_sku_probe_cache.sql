-- Non-PII marketplace SKU probe cache. No write to MoySklad.
-- rate-limited/ambiguous negative probes are never authoritative product matches.
CREATE TABLE IF NOT EXISTS office_ms_sku_probe_cache (
 sku TEXT PRIMARY KEY CHECK(length(sku) BETWEEN 1 AND 100),
 article_result TEXT NOT NULL CHECK(article_result IN
 ('not_checked','absent_exact','one_exact','ambiguous','filter_rejected',
  'permission_denied','rate_limited','response_too_large','schema_unverified',
  'source_unavailable')),
 code_result TEXT NOT NULL CHECK(code_result IN
 ('not_checked','absent_exact','one_exact','ambiguous','filter_rejected',
  'permission_denied','rate_limited','response_too_large','schema_unverified',
  'source_unavailable')),
 match_result TEXT NOT NULL CHECK(match_result IN
 ('unverified','matched_exact_article','matched_exact_code')),
 checked_at_ms INTEGER NOT NULL CHECK(checked_at_ms>=0)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_office_ms_sku_probe_checked
 ON office_ms_sku_probe_cache(checked_at_ms);
