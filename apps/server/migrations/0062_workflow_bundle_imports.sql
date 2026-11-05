CREATE TABLE workflow_bundle_imports (
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  entry_flow_id TEXT NOT NULL,
  flow_ids TEXT NOT NULL,
  PRIMARY KEY (owner_id, idempotency_key)
) STRICT;
