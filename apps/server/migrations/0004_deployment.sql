CREATE TABLE operator_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT,
  token_salt TEXT,
  session_secret TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK ((token_hash IS NULL) = (token_salt IS NULL)),
  CHECK ((token_hash IS NULL) = (claimed_at IS NULL))
) STRICT;

CREATE TABLE deployment_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision > 0),
  connector_origin TEXT,
  connector_token TEXT,
  connector_console_origin TEXT,
  integration_public_origin TEXT,
  integration_callback_key TEXT,
  llm_origin TEXT,
  llm_token TEXT,
  updated_at INTEGER NOT NULL,
  CHECK ((llm_origin IS NULL) = (llm_token IS NULL))
) STRICT;
