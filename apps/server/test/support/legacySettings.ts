import type { DatabaseSync } from 'node:sqlite'

/** Restore the grouped settings schema when a fixture rolls a current database back before migration 61. */
export function restoreGroupedServiceSettings(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE service_profiles ADD COLUMN llm_origin TEXT;
    ALTER TABLE service_profiles ADD COLUMN llm_token TEXT;
    UPDATE service_profiles SET
      llm_origin = (SELECT llm_origin FROM deployment_settings),
      llm_token = (SELECT llm_token FROM deployment_settings) WHERE mode = 'custom';
    ALTER TABLE deployment_settings DROP COLUMN llm_mode;
    ALTER TABLE deployment_settings DROP COLUMN llm_origin;
    ALTER TABLE deployment_settings DROP COLUMN llm_token;
  `)
}
