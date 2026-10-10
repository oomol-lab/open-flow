CREATE TABLE event_sources_next (
  source_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_identity TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  team_id TEXT,
  event_types_json TEXT NOT NULL CHECK (json_valid(event_types_json)),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  secrets_json TEXT NOT NULL CHECK (json_valid(secrets_json)),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_received_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, external_identity)
) STRICT;

INSERT INTO event_sources_next (
  source_id, revision, name, kind, provider, external_identity, connection_id, team_id,
  event_types_json, config_json, secrets_json, state_json, enabled, last_received_at, updated_at
)
SELECT source_id, revision, name, 'feishu', provider, app_id, connection_id, team_id,
  event_types_json,
  json_object('manageSubscriptions', json(CASE WHEN manage_subscriptions = 1 THEN 'true' ELSE 'false' END)),
  json_object('verificationToken', verification_token, 'encryptKey', encrypt_key),
  CASE WHEN verified_at IS NULL THEN '{}' ELSE json_object('verifiedAt', verified_at) END,
  enabled, last_received_at, updated_at
FROM event_sources;

DROP TABLE event_sources;
ALTER TABLE event_sources_next RENAME TO event_sources;
