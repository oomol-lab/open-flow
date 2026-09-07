ALTER TABLE runs ADD COLUMN trigger_node_id TEXT;
ALTER TABLE runs ADD COLUMN trigger_payload TEXT;

UPDATE runs
SET trigger_node_id = (SELECT trigger_node_id FROM trigger_occurrences WHERE trigger_occurrences.run_id = runs.run_id),
    trigger_payload = (SELECT payload FROM trigger_occurrences WHERE trigger_occurrences.run_id = runs.run_id)
WHERE source = 'trigger';
