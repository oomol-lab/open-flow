ALTER TABLE flow_provider_access ADD COLUMN provider_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(provider_ids_json) AND json_type(provider_ids_json) = 'array');
