CREATE TABLE poll_candidates (
  operation_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  binding_id TEXT NOT NULL UNIQUE,
  flow_id TEXT NOT NULL,
  trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json) AND json_type(trigger_json) = 'object'),
  connection_id TEXT NOT NULL,
  schedule_json TEXT NOT NULL CHECK (json_valid(schedule_json) AND json_type(schedule_json) = 'array'),
  checkpoint_json TEXT NOT NULL CHECK (json_valid(checkpoint_json)),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'ready')),
  next_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (operation_id, node_id)
) STRICT;

CREATE INDEX poll_candidates_due ON poll_candidates (status, next_at, operation_id, node_id);
