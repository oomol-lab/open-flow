-- Existing Source snapshots need an explicit deployment decision before this upgrade.
CREATE TEMP TABLE source_reference_preflight (empty INTEGER CONSTRAINT legacy_sources_require_explicit_migration CHECK (empty = 1));
INSERT INTO source_reference_preflight SELECT NOT EXISTS (SELECT 1 FROM event_sources);
DROP TABLE source_reference_preflight;

ALTER TABLE event_sources ADD COLUMN connector_json TEXT CHECK (connector_json IS NULL OR json_valid(connector_json));
ALTER TABLE event_sources ADD COLUMN pending_json TEXT CHECK (pending_json IS NULL OR json_valid(pending_json));
CREATE TABLE event_source_namespace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL
) STRICT;
INSERT INTO event_source_namespace VALUES (1, lower(hex(randomblob(16))));
