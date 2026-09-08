import { DatabaseSync } from 'node:sqlite'

export class SettingsStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync

  constructor(file: string, clock: () => number = Date.now) {
    this.#clock = clock
    this.#database = new DatabaseSync(file, { timeout: 5_000 })
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `)
    this.#database.prepare('INSERT OR IGNORE INTO deployment_settings (id, revision, updated_at) VALUES (1, 1, ?)').run(this.#clock())
  }

  state(): {
    readonly connectorConsoleOrigin: string | null
    readonly connectorOrigin: string | null
    readonly connectorToken: string | null
    readonly integrationCallbackKey: string | null
    readonly integrationPublicOrigin: string | null
    readonly llmOrigin: string | null
    readonly llmToken: string | null
    readonly revision: number
    readonly updatedAt: number
  } {
    return this.#database
      .prepare(
        `SELECT connector_console_origin AS connectorConsoleOrigin, connector_origin AS connectorOrigin,
                connector_token AS connectorToken, integration_callback_key AS integrationCallbackKey,
                integration_public_origin AS integrationPublicOrigin, llm_origin AS llmOrigin, llm_token AS llmToken,
                revision, updated_at AS updatedAt
         FROM deployment_settings WHERE id = 1`,
      )
      .get() as {
      readonly connectorConsoleOrigin: string | null
      readonly connectorOrigin: string | null
      readonly connectorToken: string | null
      readonly integrationCallbackKey: string | null
      readonly integrationPublicOrigin: string | null
      readonly llmOrigin: string | null
      readonly llmToken: string | null
      readonly revision: number
      readonly updatedAt: number
    }
  }

  putConnector(expectedRevision: number, origin: string, token: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET connector_origin = ?, connector_token = ?, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(origin, token, this.#clock(), expectedRevision).changes == 1
    )
  }

  deleteConnector(expectedRevision: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET connector_origin = NULL, connector_token = NULL, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(this.#clock(), expectedRevision).changes == 1
    )
  }

  putConnectorConsole(expectedRevision: number, origin: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET connector_console_origin = ?, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(origin, this.#clock(), expectedRevision).changes == 1
    )
  }

  deleteConnectorConsole(expectedRevision: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET connector_console_origin = NULL, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(this.#clock(), expectedRevision).changes == 1
    )
  }

  putIntegration(expectedRevision: number, publicOrigin: string, callbackKey: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET integration_public_origin = ?, integration_callback_key = ?, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(publicOrigin, callbackKey, this.#clock(), expectedRevision).changes == 1
    )
  }

  deleteIntegration(expectedRevision: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET integration_public_origin = NULL, integration_callback_key = NULL, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(this.#clock(), expectedRevision).changes == 1
    )
  }

  putLlm(expectedRevision: number, origin: string, token: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET llm_origin = ?, llm_token = ?, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(origin, token, this.#clock(), expectedRevision).changes == 1
    )
  }

  deleteLlm(expectedRevision: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE deployment_settings
           SET llm_origin = NULL, llm_token = NULL, revision = revision + 1, updated_at = ?
           WHERE id = 1 AND revision = ?`,
        )
        .run(this.#clock(), expectedRevision).changes == 1
    )
  }

  close(): void {
    this.#database.close()
  }
}
