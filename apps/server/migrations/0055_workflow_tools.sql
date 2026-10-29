ALTER TABLE workflow_calls RENAME TO workflow_calls_old;
DROP INDEX workflow_call_deadline;
CREATE TABLE workflow_calls (
  parent_run_id TEXT NOT NULL,
  parent_flow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  call_id TEXT NOT NULL DEFAULT '',
  execution_id TEXT NOT NULL,
  child_run_id TEXT NOT NULL UNIQUE,
  child_flow_id TEXT NOT NULL,
  deadline_at INTEGER,
  PRIMARY KEY (parent_run_id, job_id, call_id)
) STRICT;
INSERT INTO workflow_calls (parent_run_id, parent_flow_id, node_id, job_id, execution_id, child_run_id, child_flow_id, deadline_at)
SELECT parent_run_id, parent_flow_id, node_id, job_id, execution_id, child_run_id, child_flow_id, deadline_at FROM workflow_calls_old;
DROP TABLE workflow_calls_old;
CREATE INDEX workflow_call_deadline ON workflow_calls(deadline_at) WHERE deadline_at IS NOT NULL;
