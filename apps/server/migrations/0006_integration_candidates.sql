CREATE TABLE integration_candidates (
  operation_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  binding_id TEXT NOT NULL UNIQUE,
  endpoint_id TEXT NOT NULL UNIQUE,
  flow_id TEXT NOT NULL,
  trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json) AND json_type(trigger_json) = 'object'),
  connection_id TEXT NOT NULL,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  subscription_json TEXT CHECK (subscription_json IS NULL OR (json_valid(subscription_json) AND json_type(subscription_json) = 'object')),
  reconcile_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'ready', 'cleanup')),
  next_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (operation_id, node_id)
) STRICT;

CREATE INDEX integration_candidates_due ON integration_candidates (status, next_at, operation_id, node_id);
