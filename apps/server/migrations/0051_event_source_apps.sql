CREATE TABLE event_source_apps (
  kind TEXT NOT NULL,
  app_id TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  verified_at INTEGER,
  PRIMARY KEY (kind, app_id)
) STRICT;

CREATE TABLE source_event_versions (
  source_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, stream_key)
) STRICT;
