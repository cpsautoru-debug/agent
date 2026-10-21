# MAX synthetic orders → Google Sheets (staging only)

**Status:** code prepared, NOT deployed. No production environment, sheet, or branch `main` changes.

## Architecture

The existing `packing-orders-v1.json` remains authoritative for synthetic bot replies. A 30-second, best-effort poller sends **successful** `produce`, `pack`, `handover`, `accept` journal entries to a dedicated Apps Script endpoint. `packing-sheets-sync-v1.json` advances after successful acknowledgement. If the HTTP response is lost, the event may be resent; the Apps Script deduplicates by event ID. All files are in `MAX_PACKING_TEST_DIR` and must be stored on a persistent volume. A redeploy without persistent storage can lose unsent journal events.

## Deploy only after review

1. In a **new standalone Apps Script project**, paste `google/PackingTestBridge.gs` (do NOT add it to the existing reserve bridge: both define `doPost`). It is hardcoded to spreadsheet **test copy** `1x3B-6sdabZNNHCpy8la7Oqwgja7yBjU1G0n1ku0kMoI`. Check that its two existing tabs have the exact expected headers. Never modify production spreadsheet ID.
2. Set Apps Script property `MAX_TEST_SHEETS_KEY` to a **new random secret** of at least 32 characters. Do not reuse `MAX_BRIDGE_KEY`, production keys, or expose it in source control.
3. Deploy the new project as a web app: execute as owner; access as required for external POST. Use its unique `/exec` URL.
4. In **only** Render service `autosklad63-max-packing-test`, add `MAX_TEST_SHEETS_URL` (new `/exec` URL) and `MAX_TEST_SHEETS_KEY` (matching test-only secret). Do not set `SHEETS_*`, `GOOGLE_*`, or production MAX keys. These are forbidden by `packingConfig`.
5. Confirm the service has a persistent `MAX_PACKING_TEST_DIR` and backups before enabling sync. The test bot and original synthetic data continue to operate if the bridge fails.
6. Run `npm test` in `apps/max-agent` before deploy. On staging, test one fresh synthetic operation, confirm exactly one event row and correct reconciliation, then simulate a failed delivery and retry. Do not merge to `main` without separate approval.

## Limitations / checks

- Existing events in the current local journal will be backfilled on first enablement. If undesired, isolate a new staging state directory first.
- Only the five `TEST-*` fixtures are accepted. `accept` carries a shipment ID and zero quantity; per-position driver receipt is calculated from earlier handovers.
- If Google receives an event but fails before updating the reconciliation sheet, retries repair it.
- If the test journal is lost or reset, this design cannot reconstruct missing events from Google or automatically resolve session replacement. Persistent disk and manual review are required.
- The standalone GAS does not access other workbook tabs, real orders, payroll, inventory, or marketplace APIs.
