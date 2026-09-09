CREATE TABLE run_results (
  result_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (json_valid(source)),
  input_digest TEXT NOT NULL,
  digest TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0 AND bytes <= 33554432),
  content TEXT NOT NULL CHECK (json_valid(content)),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, invocation_id, call_id)
) STRICT;
CREATE INDEX run_results_run ON run_results (run_id, result_id);
