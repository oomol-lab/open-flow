CREATE TABLE event_sources (
  source_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  app_id TEXT NOT NULL UNIQUE,
  tenant_key TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  team_id TEXT,
  verification_token TEXT NOT NULL,
  encrypt_key TEXT NOT NULL,
  event_types_json TEXT NOT NULL CHECK (json_valid(event_types_json)),
  manage_subscriptions INTEGER NOT NULL CHECK (manage_subscriptions IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  verified_at INTEGER,
  last_received_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE source_events (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, event_id)
) STRICT;

CREATE TABLE source_deliveries (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  runtime_version INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'retired', 'failed')),
  error_code TEXT,
  PRIMARY KEY (source_id, event_id, binding_id)
) STRICT;
CREATE INDEX source_deliveries_due ON source_deliveries (status, next_at);

CREATE TABLE source_subscriptions (
  source_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  resource_json TEXT NOT NULL CHECK (json_valid(resource_json)),
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'deleting', 'uncertain')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, resource_key)
) STRICT;

CREATE TABLE source_demands (
  source_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  PRIMARY KEY (source_id, resource_key, binding_id)
) STRICT;
