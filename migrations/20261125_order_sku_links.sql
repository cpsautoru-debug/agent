-- Order channel SKU -> MoySklad assortment links.
-- Distinct from financial product-cost links.
CREATE TABLE IF NOT EXISTS office_order_sku_links (
 source TEXT NOT NULL CHECK(source IN ('ozon','ozon_fbo','wb','yandex')),
 seller_account TEXT NOT NULL CHECK(length(seller_account) BETWEEN 1 AND 100),
 marketplace_sku TEXT NOT NULL CHECK(length(marketplace_sku) BETWEEN 1 AND 100),
 ms_item_type TEXT NOT NULL CHECK(ms_item_type IN ('product','variant','bundle')),
 ms_item_id TEXT NOT NULL CHECK(length(ms_item_id)=36),
 ms_item_name TEXT NOT NULL CHECK(length(ms_item_name) BETWEEN 1 AND 200),
 evidence TEXT NOT NULL CHECK(evidence='owner_selected_verified_id'),
 approved_by_sub TEXT NOT NULL CHECK(length(approved_by_sub) BETWEEN 1 AND 255),
 approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(source,seller_account,marketplace_sku)
) STRICT;
CREATE INDEX IF NOT EXISTS office_order_sku_links_ms_item ON office_order_sku_links(ms_item_type,ms_item_id);
CREATE TRIGGER IF NOT EXISTS office_order_sku_links_no_update
 BEFORE UPDATE ON office_order_sku_links BEGIN SELECT RAISE(ABORT,'order SKU links immutable'); END;
CREATE TRIGGER IF NOT EXISTS office_order_sku_links_no_delete
 BEFORE DELETE ON office_order_sku_links BEGIN SELECT RAISE(ABORT,'order SKU links immutable'); END;
