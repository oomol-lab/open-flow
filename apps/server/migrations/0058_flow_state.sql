CREATE TABLE flow_state_values (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'live')),
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_run_id TEXT NOT NULL,
  PRIMARY KEY (flow_id, scope, key)
);
CREATE TABLE flow_dedupe_identities (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'live')),
  space TEXT NOT NULL,
  identity BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (flow_id, scope, space, identity)
);
CREATE TABLE flow_dedupe_spaces (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'live')),
  space TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('new', 'increasing')),
  count INTEGER NOT NULL,
  watermark_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (flow_id, scope, space)
);
CREATE TABLE flow_state_usage (
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'live')),
  bytes INTEGER NOT NULL,
  PRIMARY KEY (flow_id, scope)
);
ALTER TABLE runs ADD COLUMN state_writes INTEGER NOT NULL DEFAULT 0;
