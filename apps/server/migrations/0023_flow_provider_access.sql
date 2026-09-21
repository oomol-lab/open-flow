CREATE TABLE flow_provider_access (
  flow_id TEXT PRIMARY KEY,
  access_revision INTEGER NOT NULL CHECK (access_revision > 0),
  bindings_json TEXT NOT NULL CHECK (json_valid(bindings_json) AND json_type(bindings_json) = 'array'),
  provider_access_digest TEXT NOT NULL CHECK (length(provider_access_digest) > 0)
) STRICT;
