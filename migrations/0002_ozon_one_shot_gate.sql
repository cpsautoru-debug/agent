CREATE TABLE IF NOT EXISTS ozon_api_one_shot_gate (
  gate_id INTEGER PRIMARY KEY NOT NULL CHECK (gate_id = 1),
  sync_date TEXT NOT NULL CHECK (sync_date = '2026-10-28'),
  max_pages INTEGER NOT NULL CHECK (max_pages = 2),
  status TEXT NOT NULL DEFAULT 'disarmed'
    CHECK (status IN ('disarmed', 'armed', 'claimed')),
  armed_at TEXT,
  claimed_at TEXT,
  claim_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status = 'claimed' AND claimed_at IS NOT NULL AND claim_token IS NOT NULL)
    OR
    (status IN ('disarmed', 'armed') AND claimed_at IS NULL AND claim_token IS NULL)
  )
);

INSERT INTO ozon_api_one_shot_gate (
  gate_id,
  sync_date,
  max_pages,
  status
)
VALUES (1, '2026-10-28', 2, 'disarmed')
ON CONFLICT(gate_id) DO NOTHING;
