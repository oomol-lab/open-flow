ALTER TABLE integration_candidates ADD COLUMN provider_access_snapshot TEXT NOT NULL DEFAULT '{"accessRevision":0,"bindings":[],"mode":"implicit","providerAccessDigest":"legacy","version":1}' CHECK (json_valid(provider_access_snapshot) AND json_type(provider_access_snapshot) = 'object');

UPDATE integration_candidates
SET provider_access_snapshot = COALESCE((
  SELECT CASE WHEN substr(integration_candidates.node_id, 1, 8) = 'retired:'
    THEN (SELECT provider_access_snapshot FROM publications WHERE publication_id = operations.expected_live_publication_id)
    ELSE operations.provider_access_snapshot
  END
  FROM publish_operations AS operations
  WHERE operations.operation_id = integration_candidates.operation_id
), provider_access_snapshot);
