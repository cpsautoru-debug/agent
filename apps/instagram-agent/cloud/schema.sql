CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  thread TEXT NOT NULL,
  kind TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_retention ON events(created_at);
CREATE INDEX IF NOT EXISTS events_time ON events(event_at);
CREATE TABLE IF NOT EXISTS auto_dialogues (
  thread TEXT PRIMARY KEY,
  first_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
