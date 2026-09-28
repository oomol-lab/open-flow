CREATE TABLE error_bindings (
  binding_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  trigger_node_id TEXT NOT NULL,
  current_publication_id TEXT,
  operator_state TEXT NOT NULL DEFAULT 'active',
  runtime_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(flow_id, trigger_node_id)
);
ALTER TABLE runs ADD COLUMN failure_detail TEXT;
ALTER TABLE runs ADD COLUMN error_source_run_id TEXT;
ALTER TABLE runs ADD COLUMN error_source_flow_id TEXT;
CREATE TABLE error_dispatches (
  source_run_id TEXT PRIMARY KEY,
  source_flow_id TEXT NOT NULL,
  target_flow_id TEXT NOT NULL,
  outputs TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_at INTEGER NOT NULL,
  run_id TEXT,
  error_message TEXT
);
CREATE INDEX error_dispatch_due ON error_dispatches(retry_at) WHERE status = 'pending';
