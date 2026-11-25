-- Live D1 audit of Ozon finance SKU coverage; read-only.
-- Database: autosklad63-ozon-finance. Values are financial operations, NOT unit sales.
SELECT a.sku,MAX(a.seller_article) AS seller_article,
       COUNT(*) AS operation_rows,
       ROUND(SUM(a.amount_kopecks)/100.0,2) AS finance_net_rub,
       CASE WHEN MAX(c.status)='confirmed' THEN 'confirmed'
            WHEN MAX(c.status)='preliminary' THEN 'preliminary'
            ELSE 'missing' END AS cost_status
FROM ozon_accruals a LEFT JOIN ozon_cost_entries c ON a.sku=c.sku
WHERE a.sku IS NOT NULL AND a.sku<>''
GROUP BY a.sku ORDER BY CASE WHEN MAX(c.status) IS NULL THEN 0 ELSE 1 END,
COUNT(*) DESC;
