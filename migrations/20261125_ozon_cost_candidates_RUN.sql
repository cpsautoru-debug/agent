INSERT INTO ozon_cost_entries
(sku,seller_article,model,cost_kopecks,status,source,updated_at)
SELECT a.sku, a.seller_article, a.model, a.cost_kopecks, 'preliminary',
       'OWNER_NORM_SELLER_ARTICLE_PRELIMINARY_2026-11-25',CURRENT_TIMESTAMP
FROM (
 SELECT '4823028480' sku,'чехлы-веста с кокеткой-белая поддержка-белые соты' seller_article,'Lada Vesta' model,420000 cost_kopecks
 UNION ALL SELECT '3974064759','чехлы-веста14','Lada Vesta',420000
 UNION ALL SELECT '4806843826','чехлы-веста с кокеткой-белый квадрат','Lada Vesta',420000
 UNION ALL SELECT '3974135340','чехлы-веста-премиум-черные','Lada Vesta',420000
 UNION ALL SELECT '5633313683','чехлы-веста-белая анаконда','Lada Vesta',420000
 UNION ALL SELECT '5633255969','чехлы-веста-черная анаконда','Lada Vesta',420000
 UNION ALL SELECT '5633295853','чехлы-веста-красная анаконда','Lada Vesta',420000
 UNION ALL SELECT '578757453','samararedsoty','Lada Samara',320000
 UNION ALL SELECT '1787853051','msk-dvkartgrantasotyred','Дверные вставки',35000
 UNION ALL SELECT '1710475340','msk-dvkartvestasotyblack1','Дверные вставки',35000
 UNION ALL SELECT '1787853109','msk-dvkartgrantasotyblack','Дверные вставки',35000
 UNION ALL SELECT '1787852967','msk-dvkartdustersotywhite','Дверные вставки',35000
 UNION ALL SELECT '1787852935','msk-dvkartgrantarombwhite','Дверные вставки',35000
) a
WHERE EXISTS (
 SELECT 1 FROM ozon_accruals o
 WHERE o.sku=a.sku AND o.seller_article=a.seller_article
)
AND NOT EXISTS (
 SELECT 1 FROM ozon_cost_entries c WHERE c.sku=a.sku
);
SELECT COUNT(DISTINCT a.sku) AS distinct_skus,
       COUNT(DISTINCT c.sku) AS with_cost_record
FROM ozon_accruals a
LEFT JOIN ozon_cost_entries c ON c.sku=a.sku
WHERE a.sku IS NOT NULL AND a.sku<>'';
