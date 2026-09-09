DROP INDEX run_waits_expiry;
DROP INDEX run_waits_capability;
ALTER TABLE run_waits RENAME TO previous_waits;

CREATE TABLE run_waits (
  run_id TEXT PRIMARY KEY,
  wait_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  waiting_since INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR (json_valid(checkpoint_json) AND json_type(checkpoint_json) = 'object')),
  checkpoint_version INTEGER NOT NULL CHECK (checkpoint_version > 0),
  checkpoint_digest TEXT NOT NULL,
  checkpoint_bytes INTEGER NOT NULL CHECK (checkpoint_bytes >= 0 AND checkpoint_bytes <= 16777216),
  remaining_ms INTEGER NOT NULL CHECK (remaining_ms >= 0),
  action TEXT CHECK (action IN ('approve', 'continue', 'reject')),
  resolved_at INTEGER,
  capability_digest TEXT,
  CHECK ((action IS NULL) = (resolved_at IS NULL))
) STRICT;

CREATE INDEX run_waits_expiry ON run_waits (expires_at, run_id);
CREATE UNIQUE INDEX run_waits_capability ON run_waits (capability_digest) WHERE capability_digest IS NOT NULL;

INSERT INTO run_waits (run_id, wait_id, node_id, job_id, waiting_since, expires_at, checkpoint_json, checkpoint_version, checkpoint_digest, checkpoint_bytes, remaining_ms, action, resolved_at, capability_digest) SELECT run_id, wait_id, node_id, job_id, waiting_since, expires_at, checkpoint_json, checkpoint_version, checkpoint_digest, checkpoint_bytes, remaining_ms, action, resolved_at, capability_digest FROM previous_waits;
DROP TABLE previous_waits;

CREATE TABLE wait_receipts (
  run_id TEXT NOT NULL,
  wait_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  actions TEXT NOT NULL CHECK (json_valid(actions)),
  prompt TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  waiting_since INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  action TEXT CHECK (action IN ('approve', 'continue', 'reject')),
  resolved_at INTEGER,
  capability_digest TEXT,
  PRIMARY KEY (run_id, wait_id),
  CHECK ((action IS NULL) = (resolved_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX wait_receipts_capability ON wait_receipts (capability_digest) WHERE capability_digest IS NOT NULL;
INSERT INTO wait_receipts
SELECT w.run_id, w.wait_id, w.node_id, w.job_id, json_extract(n.value, '$.actions'),
       json_extract(n.value, '$.prompt'), COALESCE(w.checkpoint_json -> '$.wait.value', 'null'),
       w.waiting_since, w.expires_at, w.action, w.resolved_at, w.capability_digest
FROM run_waits w JOIN runs r USING (run_id) JOIN revisions v ON v.revision_id = r.revision_id,
     json_each(v.content, '$.document.graph.nodes') n
WHERE n.key = w.node_id AND json_extract(n.value, '$.kind') = 'wait';

ALTER TABLE runs ADD COLUMN llm_config TEXT CHECK (llm_config IS NULL OR json_valid(llm_config));
ALTER TABLE runs ADD COLUMN binding_values TEXT CHECK (binding_values IS NULL OR json_valid(binding_values));
