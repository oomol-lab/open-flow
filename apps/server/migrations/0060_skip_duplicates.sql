ALTER TABLE flow_dedupe_spaces DROP COLUMN mode;
ALTER TABLE flow_dedupe_spaces DROP COLUMN watermark_json;

CREATE TABLE flow_dedupe_pending (
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'live')),
  space TEXT NOT NULL,
  identity BLOB NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, job_id, space, identity)
);
CREATE INDEX flow_dedupe_pending_scope ON flow_dedupe_pending (flow_id, scope, space, identity);
