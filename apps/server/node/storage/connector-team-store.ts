import type { DatabaseSync } from 'node:sqlite'

export interface ConnectorTeamBinding {
  readonly flowId: string
  readonly teamId: string
}

/**
 * The immutable OOMOL Team a Flow is pinned to.
 *
 * A Flow never changes Team in place; selecting another Team means creating
 * another Flow.
 */
export class ConnectorTeamStore {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  get(flowId: string): string | undefined {
    const row = this.#database.prepare('SELECT team_id AS teamId FROM flow_connector_teams WHERE flow_id = ?').get(flowId) as
      | { readonly teamId: string | null }
      | undefined
    return row?.teamId ?? undefined
  }

  list(): readonly ConnectorTeamBinding[] {
    return this.#database
      .prepare('SELECT flow_id AS flowId, team_id AS teamId FROM flow_connector_teams WHERE team_id IS NOT NULL ORDER BY flow_id')
      .all() as unknown as readonly ConnectorTeamBinding[]
  }

  bind(flowId: string, teamId: string): string | undefined {
    this.#database.prepare('UPDATE flow_connector_teams SET team_id = ? WHERE flow_id = ? AND team_id IS NULL').run(teamId, flowId)
    return this.get(flowId)
  }

  bindUnassigned(teamId: string): void {
    this.#database.prepare('UPDATE flow_connector_teams SET team_id = ? WHERE team_id IS NULL').run(teamId)
  }
}
