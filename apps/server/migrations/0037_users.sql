CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
) STRICT;

ALTER TABLE flows ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'operator';
CREATE INDEX flows_owner_list ON flows (owner_id, created_at, flow_id);

-- Stage request keys so a namespaced key cannot collide with another old key during the update.
CREATE TEMP TABLE user_idempotency_keys (
  resource_id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL
) STRICT;

INSERT INTO user_idempotency_keys SELECT flow_id, create_idempotency_key FROM flows;
UPDATE flows SET create_idempotency_key = hex(randomblob(32));
UPDATE flows SET create_idempotency_key = json_array('operator', (
  SELECT request_key FROM user_idempotency_keys WHERE resource_id = flows.flow_id
));

DELETE FROM user_idempotency_keys;
INSERT INTO user_idempotency_keys SELECT run_id, idempotency_key FROM runs WHERE source IN ('draft', 'live');
UPDATE runs SET idempotency_key = hex(randomblob(32)) WHERE source IN ('draft', 'live');
UPDATE runs SET idempotency_key = json_array('operator', (
  SELECT request_key FROM user_idempotency_keys WHERE resource_id = runs.run_id
)) WHERE source IN ('draft', 'live');

DROP TABLE user_idempotency_keys;
