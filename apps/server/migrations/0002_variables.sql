CREATE TABLE variables (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;
