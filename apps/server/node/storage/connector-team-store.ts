import type { DatabaseSync } from 'node:sqlite'

export interface ConnectorTeamBinding {
  readonly flowId: string
  readonly teamId: string
  readonly teamName?: string
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
    const rows = this.#database
      .prepare(`SELECT b.flow_id AS flowId, b.team_id AS teamId, n.name AS teamName
        FROM flow_connector_teams b LEFT JOIN connector_team_names n ON n.team_id = b.team_id
        WHERE b.team_id IS NOT NULL ORDER BY b.flow_id`)
      .all() as unknown as readonly { flowId: string; teamId: string; teamName: string | null }[]
    return rows.map(({ flowId, teamId, teamName }) => (teamName == null ? { flowId, teamId } : { flowId, teamId, teamName }))
  }

  rememberNames(teams: readonly { readonly id: string; readonly name: string }[]): void {
    const update = this.#database.prepare(
      'INSERT INTO connector_team_names (team_id, name) VALUES (?, ?) ON CONFLICT(team_id) DO UPDATE SET name = excluded.name',
    )
    for (const team of teams) update.run(team.id, team.name)
  }

  bind(flowId: string, teamId: string): string | undefined {
    this.#database.prepare('UPDATE flow_connector_teams SET team_id = ? WHERE flow_id = ? AND team_id IS NULL').run(teamId, flowId)
    return this.get(flowId)
  }

  bindUnassigned(teamId: string): void {
    this.#database.prepare('UPDATE flow_connector_teams SET team_id = ? WHERE team_id IS NULL').run(teamId)
  }
}
