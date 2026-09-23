ALTER TABLE flow_revisions ADD COLUMN digest TEXT;
ALTER TABLE flow_revisions ADD COLUMN model_version INTEGER;

UPDATE flow_revisions
SET digest = (SELECT digest FROM revisions WHERE revisions.revision_id = flow_revisions.revision_id),
    model_version = (
      SELECT CASE WHEN json_valid(content) THEN json_extract(content, '$.modelVersion') END
      FROM revisions WHERE revisions.revision_id = flow_revisions.revision_id
    );

CREATE INDEX runs_revision ON runs (revision_id, source, created_at DESC, run_id DESC);
CREATE INDEX runs_recent_draft ON runs (flow_id, source, created_at DESC, run_id DESC);
CREATE INDEX flows_draft_revision ON flows (draft_revision_id);
CREATE INDEX publications_revision ON publications (revision_id);
CREATE INDEX publish_operations_pending_revision ON publish_operations (revision_id) WHERE status = 'pending';
