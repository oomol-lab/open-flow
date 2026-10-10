CREATE TABLE service_profiles (
  mode TEXT PRIMARY KEY CHECK (mode IN ('oomol', 'custom')),
  connector_origin TEXT,
  connector_token TEXT,
  console_origin TEXT,
  llm_origin TEXT,
  llm_token TEXT
) STRICT;
INSERT INTO service_profiles (mode) VALUES ('oomol'), ('custom');
ALTER TABLE deployment_settings ADD COLUMN service_mode TEXT CHECK (service_mode IN ('oomol', 'custom'));
UPDATE deployment_settings SET service_mode = CASE
  WHEN connector_origin IN ('https://connector.oomol.com', 'https://connector.oomol.dev') OR connector_origin LIKE 'https://connector.oomol.com/%' OR connector_origin LIKE 'https://connector.oomol.dev/%' OR connector_origin LIKE 'https://connector.oomol.com:%' OR connector_origin LIKE 'https://connector.oomol.dev:%' THEN 'oomol'
  WHEN connector_origin IS NOT NULL OR connector_console_origin IS NOT NULL OR llm_origin IS NOT NULL THEN 'custom'
  ELSE NULL END;
UPDATE service_profiles SET
  connector_origin = (SELECT connector_origin FROM deployment_settings WHERE service_mode = mode),
  connector_token = (SELECT connector_token FROM deployment_settings WHERE service_mode = mode),
  console_origin = CASE WHEN mode = 'custom' THEN (SELECT connector_console_origin FROM deployment_settings) END,
  llm_origin = CASE WHEN mode = 'custom' THEN (SELECT llm_origin FROM deployment_settings) END,
  llm_token = CASE WHEN mode = 'custom' THEN (SELECT llm_token FROM deployment_settings) END;
CREATE TABLE deployment_settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision > 0),
  service_mode TEXT CHECK (service_mode IN ('oomol', 'custom')),
  integration_public_origin TEXT,
  integration_callback_key TEXT,
  updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO deployment_settings_new SELECT id, revision, service_mode, integration_public_origin, integration_callback_key, updated_at FROM deployment_settings;
DROP TABLE deployment_settings;
ALTER TABLE deployment_settings_new RENAME TO deployment_settings;
