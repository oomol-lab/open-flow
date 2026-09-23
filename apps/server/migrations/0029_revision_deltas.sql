CREATE TABLE revision_deltas (
  revision_id TEXT PRIMARY KEY,
  base_revision_id TEXT NOT NULL,
  patch TEXT NOT NULL CHECK (json_valid(patch) AND json_type(patch) = 'array'),
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 32)
) STRICT;

CREATE INDEX revision_deltas_base ON revision_deltas (base_revision_id);
