CREATE TABLE tags (
  tag_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  UNIQUE (owner_id, name_key)
) STRICT;

CREATE TABLE flow_tags (
  flow_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (flow_id, tag_id)
) STRICT;

CREATE INDEX flow_tags_by_tag ON flow_tags (tag_id, flow_id);
