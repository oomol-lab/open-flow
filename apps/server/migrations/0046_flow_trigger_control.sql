-- Preserve stopped admission when a current Trigger was individually paused.
UPDATE flow_live
SET enabled = 0
WHERE EXISTS (
  SELECT 1 FROM (
    SELECT flow_id, current_publication_id FROM webhook_bindings WHERE operator_state = 'paused'
    UNION ALL
    SELECT flow_id, current_publication_id FROM cron_bindings WHERE operator_state = 'paused'
    UNION ALL
    SELECT flow_id, current_publication_id FROM poll_bindings WHERE operator_state = 'paused'
    UNION ALL
    SELECT flow_id, current_publication_id FROM integration_bindings WHERE operator_state = 'paused'
    UNION ALL
    SELECT flow_id, current_publication_id FROM error_bindings WHERE operator_state = 'paused'
  ) AS paused
  WHERE paused.flow_id = flow_live.flow_id AND paused.current_publication_id = flow_live.publication_id
);

ALTER TABLE webhook_bindings DROP COLUMN operator_state;
ALTER TABLE cron_bindings DROP COLUMN operator_state;
ALTER TABLE poll_bindings DROP COLUMN operator_state;
ALTER TABLE integration_bindings DROP COLUMN operator_state;
ALTER TABLE error_bindings DROP COLUMN operator_state;
