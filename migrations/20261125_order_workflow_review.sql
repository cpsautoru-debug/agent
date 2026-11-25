CREATE TABLE IF NOT EXISTS office_order_workflow (
 order_key TEXT NOT NULL PRIMARY KEY REFERENCES office_order_queue(order_key),
 workflow_state TEXT NOT NULL CHECK(workflow_state IN
  ('pending_review','reviewed','stock_check_requested','on_hold')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_by_sub TEXT NOT NULL CHECK(length(updated_by_sub) BETWEEN 1 AND 255),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=300)
) STRICT;
CREATE TABLE IF NOT EXISTS office_order_workflow_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_key TEXT NOT NULL REFERENCES office_order_queue(order_key),
 event_kind TEXT NOT NULL CHECK(event_kind='owner_workflow_transition'),
 from_state TEXT,
 to_state TEXT NOT NULL,
 revision INTEGER NOT NULL,
 actor_sub TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(order_key,revision)
) STRICT;
CREATE INDEX IF NOT EXISTS office_order_workflow_events_order ON office_order_workflow_events(order_key,id);
CREATE TRIGGER IF NOT EXISTS office_order_workflow_audit_insert
AFTER INSERT ON office_order_workflow BEGIN
 INSERT INTO office_order_workflow_events(order_key,event_kind,from_state,to_state,revision,actor_sub,note)
 VALUES(NEW.order_key,'owner_workflow_transition',NULL,NEW.workflow_state,NEW.revision,NEW.updated_by_sub,NEW.note);
END;
CREATE TRIGGER IF NOT EXISTS office_order_workflow_audit_update
AFTER UPDATE OF workflow_state ON office_order_workflow
WHEN NEW.workflow_state<>OLD.workflow_state BEGIN
 INSERT INTO office_order_workflow_events(order_key,event_kind,from_state,to_state,revision,actor_sub,note)
 VALUES(NEW.order_key,'owner_workflow_transition',OLD.workflow_state,NEW.workflow_state,NEW.revision,NEW.updated_by_sub,NEW.note);
END;
CREATE TRIGGER IF NOT EXISTS office_order_workflow_no_delete
BEFORE DELETE ON office_order_workflow BEGIN
 SELECT RAISE(ABORT,'workflow cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS office_order_workflow_events_no_update
BEFORE UPDATE ON office_order_workflow_events BEGIN
 SELECT RAISE(ABORT,'workflow event immutable');
END;
CREATE TRIGGER IF NOT EXISTS office_order_workflow_events_no_delete
BEFORE DELETE ON office_order_workflow_events BEGIN
 SELECT RAISE(ABORT,'workflow event immutable');
END;
