# Производство без платного сотрудника «МойСклад»: Pages read bridge (staging)

Сценарий: тариф «МойСклад» блокирует третьего сотрудника. В Pages autosklad63-office-staging уже есть encrypted MS_API_TOKEN, но его значение не видно пользователю. Новый токен того же пользователя отзывает старые, поэтому его не генерируем.

## Реализованная архитектура

- functions/api/ms/production-bridge.js: Pages Function, закрытая HMAC-аутентификацией (X-MS-Bridge-Time и X-MS-Bridge-Signature). Без подписи запросов к MoySklad нет, HTTP 401.
- Единственные допустимые исходящие операции: GET порции из пяти productiontask, отсортированных moment,asc, и GET productionstage со строгим фильтром productionTask по UUID. Произвольный URL, пути, метод записи, дополнительные фильтры запрещены.
- workers/ms-production-bridge-auth.js: WebCrypto HMAC-SHA256 с новым отдельным случайным 32-байтовым секретом в base64url (43 символа).
- workers/ms-production-autosync.js: старый direct mode сохраняется при наличии MS_API_TOKEN в Worker. Если токена нет, но есть MS_PRODUCTION_BRIDGE_SECRET, применяется защищённый Pages bridge.
- Не более 6 внешних GET за Cron tick; строго последовательно, 2 сек между запросами. Никаких записей в MoySklad и финансовые D1. Это историческая выборка, а НЕ подтверждённая живая очередь.

## Конкретное задание Codex

1. После слияния PR обновить локальную ветку feature/marketplace-agents-staging и выполнить node --test tests/ms/ms-production-autosync.test.mjs tests/ms/ms-production-bridge.test.mjs.
2. Убедиться, что Pages autosklad63-office-staging хранит существующий encrypted MS_API_TOKEN. Не читать/не изменять/не перевыпускать. Убедиться, что Pages endpoint /api/ms/production-feed из действующей owner-сессии функционирует (не копировать данные в отчёт).
3. В доверенной локальной среде создать случайный секрет 32 bytes = 43 chars base64url. Установить одно и то же значение в Pages staging и Worker autosklad63-ms-production-autosync-staging как encrypted MS_PRODUCTION_BRIDGE_SECRET. Нельзя показывать значение в переписке, логах, командах/истории, GitHub. Если нужны интерактивные действия пользователя — попросить ровно их. Удалить временную копию секрета после установки.
4. Развернуть Pages staging с новым API function. Анонимный GET https://autosklad63-office-staging.pages.dev/api/ms/production-bridge?kind=tasks&offset=0 должен дать HTTP 401, не 200/404. Неверные подписи тестировать только синтетически.
5. Развернуть Worker staging из обновлённого исходника, оставив MS_PRODUCTION_AUTO_SYNC=disabled. Привязка MS_PRODUCTION_DB должна сохраниться. MS_API_TOKEN в Worker не нужен. Проверь, что новый MS_PRODUCTION_BRIDGE_SECRET доступен Worker как Secret.
6. После подготовки обеих сторон и публикации активных версий включить MS_PRODUCTION_AUTO_SYNC=enabled и Cron */5 * * * *. Наблюдать два реальных ограниченных тика, каждый максимум 6 API GET, с интервалами 2 сек. Не выкладывать реальные данные и секреты в лог.
7. Проверить D1 cursor/last_success_ms и owner-only GET /api/ms/production-auto-status в офисе. Анонимная сессия должна получить HTTP 401. Исторические незавершённые не считать полной актуальной очередью без дополнительного подтверждения.
8. При 401/403/429/ошибке источника вернуть флаг disabled. Отчёт должен точно отделять готовый GitHub код от реально активированного Cron.

## Приёмка

- Worker и Pages имеют один и тот же новый HMAC secret; действующий MS_API_TOKEN остался только в Pages.
- Анонимный bridge GET => 401, неверный scope даже с подписью => 400.
- Два ограниченных тика прошли, cursor >0, свежие результаты доступны только владельцу офиса.
- Действующие токены MoySklad и тариф не изменились; третьего сотрудника не создавали.
- Если исходный MS_API_TOKEN в Pages уже недействителен, bridge безопасно остановится. Понадобится согласованная авторизация, а не обход токена.
