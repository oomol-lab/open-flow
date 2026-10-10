import type { Database } from './database.ts'

export type ServiceMode = 'oomol' | 'custom'
export type ServiceProfile = {
  readonly connectorOrigin: string | null
  readonly connectorToken: string | null
  readonly consoleOrigin: string | null
  readonly llmOrigin: string | null
  readonly llmToken: string | null
}

export class SettingsStore {
  readonly #clock: () => number
  readonly #database: Database

  constructor(database: Database, clock: () => number = Date.now) {
    this.#clock = clock
    this.#database = database
    database.connection.prepare('INSERT OR IGNORE INTO deployment_settings (id, revision, updated_at) VALUES (1, 1, ?)').run(this.#clock())
  }

  profile(mode: ServiceMode): ServiceProfile {
    return this.#database.connection
      .prepare(`SELECT connector_origin AS connectorOrigin, connector_token AS connectorToken,
      console_origin AS consoleOrigin, llm_origin AS llmOrigin, llm_token AS llmToken FROM service_profiles WHERE mode = ?`)
      .get(mode) as ServiceProfile
  }

  state() {
    const settings = this.#database.connection
      .prepare(`SELECT service_mode AS serviceMode, integration_callback_key AS integrationCallbackKey,
      integration_public_origin AS integrationPublicOrigin, revision, updated_at AS updatedAt FROM deployment_settings WHERE id = 1`)
      .get() as {
      readonly serviceMode: ServiceMode | null
      readonly integrationCallbackKey: string | null
      readonly integrationPublicOrigin: string | null
      readonly revision: number
      readonly updatedAt: number
    }
    const { consoleOrigin, ...profile } =
      settings.serviceMode == null
        ? { consoleOrigin: null, connectorOrigin: null, connectorToken: null, llmOrigin: null, llmToken: null }
        : this.profile(settings.serviceMode)
    return { ...settings, ...profile, connectorConsoleOrigin: consoleOrigin }
  }

  /** Profile data and selection share one optimistic revision and one transaction. */
  putProfile(expectedRevision: number, mode: ServiceMode, value: ServiceProfile, activate = false): boolean {
    return this.#database.transaction(() => {
      if (!this.#revise(expectedRevision)) return false
      this.#database.connection
        .prepare(`UPDATE service_profiles SET connector_origin = ?, connector_token = ?, console_origin = ?,
        llm_origin = ?, llm_token = ? WHERE mode = ?`)
        .run(value.connectorOrigin, value.connectorToken, value.consoleOrigin, value.llmOrigin, value.llmToken, mode)
      if (activate) this.#database.connection.prepare('UPDATE deployment_settings SET service_mode = ? WHERE id = 1').run(mode)
      return true
    })
  }

  selectProfile(expectedRevision: number, mode: ServiceMode): boolean {
    return (
      this.#database.connection
        .prepare(`UPDATE deployment_settings SET service_mode = ?, revision = revision + 1, updated_at = ?
      WHERE id = 1 AND revision = ?`)
        .run(mode, this.#clock(), expectedRevision).changes == 1
    )
  }

  putServices(expectedRevision: number, value: ServiceProfile): boolean {
    const mode =
      value.connectorOrigin != null && ['connector.oomol.com', 'connector.oomol.dev'].includes(new URL(value.connectorOrigin).hostname) ? 'oomol' : 'custom'
    return this.putProfile(expectedRevision, mode, value, true)
  }

  putConnector(expectedRevision: number, origin: string, token: string): boolean {
    const mode = ['connector.oomol.com', 'connector.oomol.dev'].includes(new URL(origin).hostname) ? 'oomol' : 'custom'
    return this.putProfile(expectedRevision, mode, { ...this.profile(mode), connectorOrigin: origin, connectorToken: token }, true)
  }

  deleteConnector(expectedRevision: number): boolean {
    const mode = this.state().serviceMode
    if (mode == null) return this.#revise(expectedRevision)
    return this.putProfile(expectedRevision, mode, { ...this.profile(mode), connectorOrigin: null, connectorToken: null })
  }

  putConnectorConsole(expectedRevision: number, origin: string): boolean {
    return this.putProfile(expectedRevision, 'custom', { ...this.profile('custom'), consoleOrigin: origin }, true)
  }

  deleteConnectorConsole(expectedRevision: number): boolean {
    return this.putProfile(expectedRevision, 'custom', { ...this.profile('custom'), consoleOrigin: null })
  }

  putIntegration(expectedRevision: number, publicOrigin: string, callbackKey: string): boolean {
    return (
      this.#database.connection
        .prepare(`UPDATE deployment_settings SET integration_public_origin = ?, integration_callback_key = ?,
      revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?`)
        .run(publicOrigin, callbackKey, this.#clock(), expectedRevision).changes == 1
    )
  }

  deleteIntegration(expectedRevision: number): boolean {
    return (
      this.#database.connection
        .prepare(`UPDATE deployment_settings SET integration_public_origin = NULL, integration_callback_key = NULL,
      revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?`)
        .run(this.#clock(), expectedRevision).changes == 1
    )
  }

  putLlm(expectedRevision: number, origin: string, token: string): boolean {
    return this.putProfile(expectedRevision, 'custom', { ...this.profile('custom'), llmOrigin: origin, llmToken: token }, true)
  }

  deleteLlm(expectedRevision: number): boolean {
    return this.putProfile(expectedRevision, 'custom', { ...this.profile('custom'), llmOrigin: null, llmToken: null })
  }

  #revise(expectedRevision: number): boolean {
    return (
      this.#database.connection
        .prepare('UPDATE deployment_settings SET revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?')
        .run(this.#clock(), expectedRevision).changes == 1
    )
  }
}
