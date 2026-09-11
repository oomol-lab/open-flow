CREATE TABLE listener_work (
  binding_id TEXT PRIMARY KEY,
  runtime_version INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  health TEXT NOT NULL DEFAULT 'healthy' CHECK (health IN ('healthy', 'failed', 'needs_reauth')),
  last_error_code TEXT
) STRICT;

CREATE INDEX listener_work_due ON listener_work (next_at);
