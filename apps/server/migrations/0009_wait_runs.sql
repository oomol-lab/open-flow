DROP INDEX runs_flow_list;
DROP INDEX runs_events_expiry;

ALTER TABLE runs RENAME TO runs_before_wait;

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  closure_digest TEXT NOT NULL,
  model_version INTEGER NOT NULL CHECK (model_version > 0),
  engine_contract TEXT NOT NULL,
  engine_digest TEXT NOT NULL,
  inputs TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('draft', 'live', 'trigger')),
  publication_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'starting', 'running', 'waiting', 'canceled', 'completed', 'failed', 'indeterminate')),
  result TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  event_bytes INTEGER NOT NULL DEFAULT 0,
  events_truncated INTEGER NOT NULL DEFAULT 0 CHECK (events_truncated IN (0, 1)),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  events_expires_at INTEGER,
  connector_team_id TEXT CHECK (connector_team_id IS NULL OR length(connector_team_id) > 0)
) STRICT;

INSERT INTO runs (
  run_id, idempotency_key, request_digest, flow_id, revision_id, revision_digest,
  closure_digest, model_version, engine_contract, engine_digest, inputs, source,
  publication_id, status, result, event_count, event_bytes, events_truncated,
  created_at, started_at, finished_at, events_expires_at, connector_team_id
)
SELECT
  run_id, idempotency_key, request_digest, flow_id, revision_id, revision_digest,
  closure_digest, model_version, engine_contract, engine_digest, inputs, source,
  publication_id, status, result, event_count, event_bytes, events_truncated,
  created_at, started_at, finished_at, events_expires_at, connector_team_id
FROM runs_before_wait;

DROP TABLE runs_before_wait;

CREATE INDEX runs_flow_list ON runs (flow_id, created_at, run_id);
CREATE INDEX runs_events_expiry ON runs (events_expires_at, run_id);
CREATE INDEX runs_wait_order ON runs (flow_id, status, created_at, run_id);

CREATE TABLE run_waits (
  run_id TEXT PRIMARY KEY,
  wait_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_order INTEGER NOT NULL CHECK (job_order >= 0),
  waiting_since INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR (json_valid(checkpoint_json) AND json_type(checkpoint_json) = 'object')),
  checkpoint_version INTEGER NOT NULL CHECK (checkpoint_version = 1),
  checkpoint_digest TEXT NOT NULL,
  checkpoint_bytes INTEGER NOT NULL CHECK (checkpoint_bytes >= 0 AND checkpoint_bytes <= 16777216),
  remaining_ms INTEGER NOT NULL CHECK (remaining_ms >= 0),
  action TEXT CHECK (action IN ('approve', 'continue', 'reject')),
  resolved_at INTEGER,
  capability_digest TEXT,
  CHECK ((action IS NULL) = (resolved_at IS NULL))
) STRICT;

CREATE INDEX run_waits_expiry ON run_waits (expires_at, run_id);
CREATE UNIQUE INDEX run_waits_capability ON run_waits (capability_digest) WHERE capability_digest IS NOT NULL;

CREATE TABLE wait_notifications (
  run_id TEXT PRIMARY KEY,
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
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX wait_notifications_due ON wait_notifications (status, retry_at, claim_expires_at, run_id);
