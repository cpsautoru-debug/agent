const ALLOWED_DATE = "2026-10-28";
const ALLOWED_MAX_PAGES = 2;

export async function claimOzonOneShotGate(
  db,
  { date, maxPages }
) {
  if (
    !db ||
    date !== ALLOWED_DATE ||
    maxPages !== ALLOWED_MAX_PAGES
  ) {
    throw new Error("Invalid one-shot gate configuration");
  }

  const claimToken = crypto.randomUUID();
  const claimedAt = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE ozon_api_one_shot_gate
    SET status = 'claimed',
        claimed_at = ?,
        claim_token = ?,
        updated_at = ?
    WHERE gate_id = 1
      AND status = 'armed'
      AND sync_date = ?
      AND max_pages = ?
    RETURNING sync_date, max_pages, status, claim_token
  `).bind(
    claimedAt,
    claimToken,
    claimedAt,
    date,
    maxPages
  ).first();

  if (
    !result ||
    result.status !== "claimed" ||
    result.sync_date !== ALLOWED_DATE ||
    result.max_pages !== ALLOWED_MAX_PAGES ||
    result.claim_token !== claimToken
  ) {
    return null;
  }

  return {
    date: result.sync_date,
    maxPages: result.max_pages,
    claimToken: result.claim_token
  };
}
