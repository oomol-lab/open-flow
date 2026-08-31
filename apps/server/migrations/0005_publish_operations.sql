CREATE TABLE publish_operations (
  operation_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  closure_digest TEXT NOT NULL,
  engine_contract TEXT NOT NULL,
  expected_live_publication_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json) AND json_type(input_json) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  publication_id TEXT,
  issue_node_id TEXT,
  issue_code TEXT,
  issue_message TEXT CHECK (issue_message IS NULL OR length(issue_message) <= 512),
  deadline_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (flow_id, idempotency_key),
  CHECK (
    (status = 'pending' AND publication_id IS NULL AND issue_code IS NULL AND issue_message IS NULL) OR
    (status = 'succeeded' AND publication_id IS NOT NULL AND issue_code IS NULL AND issue_message IS NULL) OR
    (status = 'failed' AND publication_id IS NULL AND issue_code IS NOT NULL AND issue_message IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX publish_operations_pending_flow ON publish_operations (flow_id) WHERE status = 'pending';
CREATE INDEX publish_operations_expiry ON publish_operations (expires_at, operation_id);

CREATE TABLE publish_work (
  work_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  node_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  next_at INTEGER,
  issue_code TEXT,
  issue_message TEXT CHECK (issue_message IS NULL OR length(issue_message) <= 512),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (operation_id, node_id, action),
  CHECK (
    (status = 'failed' AND issue_code IS NOT NULL AND issue_message IS NOT NULL) OR
    (status != 'failed' AND issue_code IS NULL AND issue_message IS NULL)
  )
) STRICT;

CREATE INDEX publish_work_due ON publish_work (status, next_at, work_id);
CREATE INDEX publish_work_operation ON publish_work (operation_id, status);
