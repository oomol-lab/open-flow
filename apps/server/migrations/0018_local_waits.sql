CREATE TABLE run_checkpoints (
  run_id TEXT PRIMARY KEY,
  checkpoint_json TEXT,
  checkpoint_digest TEXT NOT NULL,
  checkpoint_bytes INTEGER NOT NULL,
  remaining_ms INTEGER NOT NULL CHECK (remaining_ms >= 0)
) STRICT;
INSERT INTO run_checkpoints SELECT run_id, checkpoint_json, checkpoint_digest, checkpoint_bytes, remaining_ms FROM run_waits;
DROP TABLE run_waits;
ALTER TABLE wait_receipts ADD COLUMN notification_output TEXT;
CREATE INDEX wait_receipts_pending ON wait_receipts (run_id, action, expires_at);
ALTER TABLE wait_notifications RENAME TO previous_notifications;
CREATE TABLE wait_notifications (
  run_id TEXT NOT NULL,
  wait_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  connection_id TEXT,
  task_id TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND json_type(input_json) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at INTEGER NOT NULL,
  claim_id TEXT,
  claim_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, wait_id)
) STRICT;
INSERT INTO wait_notifications SELECT * FROM previous_notifications;
DROP TABLE previous_notifications;
CREATE INDEX wait_notifications_due ON wait_notifications (status, retry_at, claim_expires_at, run_id);
