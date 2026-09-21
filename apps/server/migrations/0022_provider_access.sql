ALTER TABLE publications ADD COLUMN provider_access_digest TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE publications ADD COLUMN provider_access_snapshot TEXT NOT NULL DEFAULT '{"accessRevision":0,"bindings":[],"mode":"implicit","providerAccessDigest":"legacy","version":1}' CHECK (json_valid(provider_access_snapshot) AND json_type(provider_access_snapshot) = 'object');

ALTER TABLE publish_operations ADD COLUMN provider_access_snapshot TEXT NOT NULL DEFAULT '{"accessRevision":0,"bindings":[],"mode":"implicit","providerAccessDigest":"legacy","version":1}' CHECK (json_valid(provider_access_snapshot) AND json_type(provider_access_snapshot) = 'object');

ALTER TABLE runs ADD COLUMN provider_access_snapshot TEXT NOT NULL DEFAULT '{"accessRevision":0,"bindings":[],"mode":"implicit","providerAccessDigest":"legacy","version":1}' CHECK (json_valid(provider_access_snapshot) AND json_type(provider_access_snapshot) = 'object');

ALTER TABLE source_subscriptions ADD COLUMN provider_access_snapshot TEXT NOT NULL DEFAULT '{"accessRevision":0,"bindings":[],"mode":"implicit","providerAccessDigest":"legacy","version":1}' CHECK (json_valid(provider_access_snapshot) AND json_type(provider_access_snapshot) = 'object');

ALTER TABLE integration_states ADD COLUMN provider_access_snapshot TEXT NOT NULL DEFAULT '{"accessRevision":0,"bindings":[],"mode":"implicit","providerAccessDigest":"legacy","version":1}' CHECK (json_valid(provider_access_snapshot) AND json_type(provider_access_snapshot) = 'object');
