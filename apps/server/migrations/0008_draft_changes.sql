ALTER TABLE flow_revisions ADD COLUMN change_id TEXT;
ALTER TABLE flow_revisions ADD COLUMN change_request_digest TEXT;

CREATE UNIQUE INDEX flow_revisions_change ON flow_revisions (flow_id, change_id) WHERE change_id IS NOT NULL;
