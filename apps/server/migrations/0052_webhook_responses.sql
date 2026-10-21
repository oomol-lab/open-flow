CREATE TABLE webhook_responses (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY (run_id, node_id)
);
