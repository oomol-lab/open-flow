CREATE TABLE error_subscriptions (
  handler_flow_id TEXT NOT NULL,
  source_flow_id TEXT NOT NULL,
  PRIMARY KEY(handler_flow_id, source_flow_id)
);
CREATE INDEX error_subscription_source ON error_subscriptions(source_flow_id);
ALTER TABLE error_dispatches RENAME TO error_dispatches_old;
DROP INDEX error_dispatch_due;
CREATE TABLE error_dispatches (
  source_run_id TEXT NOT NULL,
  source_flow_id TEXT NOT NULL,
  target_flow_id TEXT NOT NULL,
  outputs TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_at INTEGER NOT NULL,
  run_id TEXT,
  error_message TEXT,
  PRIMARY KEY(source_run_id, target_flow_id)
);
INSERT INTO error_dispatches SELECT * FROM error_dispatches_old;
DROP TABLE error_dispatches_old;
CREATE INDEX error_dispatch_due ON error_dispatches(retry_at) WHERE status = 'pending';
