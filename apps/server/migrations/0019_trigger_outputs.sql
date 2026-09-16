ALTER TABLE runs RENAME COLUMN trigger_payload TO trigger_outputs;
ALTER TABLE trigger_occurrences RENAME COLUMN payload TO outputs;
