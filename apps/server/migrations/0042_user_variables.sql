CREATE TABLE user_variables (
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (owner_id, name)
) STRICT;

INSERT INTO user_variables (owner_id, name, value, updated_at)
SELECT 'operator', name, value, updated_at FROM variables;

DROP TABLE variables;
ALTER TABLE user_variables RENAME TO variables;
