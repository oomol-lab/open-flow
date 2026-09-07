export interface ConnectorAction {
  readonly actionId: string
  readonly authenticated?: boolean
  readonly description?: string
  readonly homepageUrl?: string
  readonly iconUrl?: string
  readonly inputSchema: unknown
  readonly name: string
  readonly outputSchema: unknown
  readonly service: string
}

export interface ConnectorConnection {
  readonly alias?: string
  readonly displayName: string
  readonly id: string
  readonly isDefault: boolean
  readonly service: string
  readonly status: 'active' | 'disconnected' | 'error' | 'reauth_required'
}

export function defaultConnection(connections: readonly ConnectorConnection[]): ConnectorConnection | undefined {
  const active = connections.filter((connection) => connection.status == 'active')
  return active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined)
}
