-- Separate staff identity registry. No accounts or permissions are provisioned by this migration.
CREATE TABLE IF NOT EXISTS office_staff_access (
 google_sub TEXT PRIMARY KEY NOT NULL,
 email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('orders','sewing','cutting','packing','accounting','dispatch')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
