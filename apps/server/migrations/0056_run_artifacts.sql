CREATE TABLE run_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT,
  size INTEGER NOT NULL CHECK (size >= 0),
  digest TEXT NOT NULL,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX run_artifacts_run ON run_artifacts (run_id);
