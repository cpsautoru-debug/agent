-- Staging-only, additive metadata index for read-only MoySklad production API.
-- Must be applied to a DEDICATED production-monitor D1 database, not finance D1.
CREATE TABLE IF NOT EXISTS ms_production_auto_runtime (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  next_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
  total_first_seen INTEGER CHECK (total_first_seen >= 0),
  run_status TEXT NOT NULL DEFAULT 'new'
    CHECK (run_status IN ('new','scanning','pass_complete','paused','error')),
  last_error_code TEXT NOT NULL DEFAULT '',
  lock_until_ms INTEGER NOT NULL DEFAULT 0,
  last_request_ms INTEGER NOT NULL DEFAULT 0,
  last_success_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO ms_production_auto_runtime(id) VALUES (1);
CREATE TABLE IF NOT EXISTS ms_production_auto_tasks (
  generation INTEGER NOT NULL CHECK (generation > 0),
  task_id TEXT NOT NULL,
  number TEXT NOT NULL,
  document_moment TEXT NOT NULL,
  document_updated TEXT,
  plan_date TEXT,
  task_stage_status TEXT NOT NULL
    CHECK (task_stage_status IN ('incomplete','complete','unverified')),
  planned_qty REAL,
  completed_last_stage_qty REAL,
  remaining_qty REAL,
  first_unfinished_stage TEXT,
  checked_ms INTEGER NOT NULL CHECK (checked_ms > 0),
  PRIMARY KEY(generation,task_id)
);
CREATE INDEX IF NOT EXISTS idx_ms_auto_generation_status
  ON ms_production_auto_tasks(generation,task_stage_status);
