DROP INDEX runs_revision;
DROP INDEX runs_recent_draft;

ALTER TABLE runs ADD COLUMN migrated_source TEXT NOT NULL DEFAULT 'live' CHECK (migrated_source IN ('draft', 'live'));
UPDATE runs SET migrated_source = CASE WHEN source = 'trigger' THEN 'live' ELSE source END;
ALTER TABLE runs DROP COLUMN source;
ALTER TABLE runs RENAME COLUMN migrated_source TO source;

CREATE INDEX runs_revision ON runs (revision_id, source, created_at DESC, run_id DESC);
CREATE INDEX runs_recent_draft ON runs (flow_id, source, created_at DESC, run_id DESC);
