CREATE TABLE user_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX user_tokens_owner ON user_tokens (user_id, created_at, token_id);
