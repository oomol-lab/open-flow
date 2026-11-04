ALTER TABLE deployment_settings ADD COLUMN llm_mode TEXT CHECK (llm_mode IN ('oomol', 'custom', 'none'));
ALTER TABLE deployment_settings ADD COLUMN llm_origin TEXT;
ALTER TABLE deployment_settings ADD COLUMN llm_token TEXT;
UPDATE deployment_settings SET
  llm_origin = (SELECT llm_origin FROM service_profiles WHERE mode = 'custom'),
  llm_token = (SELECT llm_token FROM service_profiles WHERE mode = 'custom');
ALTER TABLE service_profiles DROP COLUMN llm_origin;
ALTER TABLE service_profiles DROP COLUMN llm_token;
