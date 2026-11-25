INSERT INTO ozon_cost_entries
(sku, seller_article, model, cost_kopecks, status, source, updated_at)
VALUES
('4823028480', 'чехлы-веста с кокеткой-белая поддержка-белые соты', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('3974064759', 'чехлы-веста14', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('4806843826', 'чехлы-веста с кокеткой-белый квадрат', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('3974135340', 'чехлы-веста-премиум-черные', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('5633313683', 'чехлы-веста-белая анаконда', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('5633255969', 'чехлы-веста-черная анаконда', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('5633295853', 'чехлы-веста-красная анаконда', 'Lada Vesta', 420000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('578757453', 'samararedsoty', 'Lada Samara', 320000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('1787853051', 'msk-dvkartgrantasotyred', 'Дверные вставки', 35000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('1710475340', 'msk-dvkartvestasotyblack1', 'Дверные вставки', 35000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('1787853109', 'msk-dvkartgrantasotyblack', 'Дверные вставки', 35000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('1787852967', 'msk-dvkartdustersotywhite', 'Дверные вставки', 35000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP),
('1787852935', 'msk-dvkartgrantarombwhite', 'Дверные вставки', 35000, 'preliminary', 'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25', CURRENT_TIMESTAMP)
ON CONFLICT(sku) DO NOTHING;
