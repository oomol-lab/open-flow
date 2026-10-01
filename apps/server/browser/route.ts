import type { WorkbenchLocation, WorkbenchView } from '@oomol-lab/open-flow/workbench'

export interface ServerRoute {
  readonly connectorOwnerId?: string
  readonly location: WorkbenchLocation
}

export function routeOwnerForFlow(
  location: WorkbenchLocation,
  currentOwner: string | undefined,
  flowId: string | undefined,
  bindings: readonly { readonly flowId: string; readonly teamId: string }[],
  teams: readonly { readonly id: string; readonly name: string }[],
): string | undefined {
  if (flowId == null) return
  const teamId = bindings.find((binding) => binding.flowId == flowId)?.teamId
  const owner = teams.find((team) => team.id == teamId)?.name
  return owner ?? (location.flowId == flowId ? currentOwner : undefined)
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return
  }
}

export function parseRouteContext(path: string): ServerRoute {
  const [pathname = '/', search] = path.split('?')
  const source = new URLSearchParams(search).get('source')
  const runId = new URLSearchParams(search).get('runId')
  const parts = pathname.split('/').filter(Boolean)
  const teamScoped = parts[0] == 'team'
  const offset = teamScoped ? 2 : 0
  if ((teamScoped && parts.length != 5) || (!teamScoped && parts.length != 3) || parts[offset] != 'flows') return { location: { view: 'design' } }
  const connectorOwnerId = teamScoped ? decode(parts[1]!) : undefined
  const flowId = decode(parts[offset + 1]!)
  if (flowId == null || (teamScoped && connectorOwnerId == null)) return { location: { view: 'design' } }
  const view = parts[offset + 2]
  switch (view) {
    case 'design':
    case 'publications':
    case 'runs':
      return {
        connectorOwnerId,
        location: {
          flowId,
          view: view as WorkbenchView,
          ...(view == 'runs' && runId ? { runId } : {}),
          ...(view == 'runs' && (source == 'draft' || source == 'live') ? { runSource: source } : {}),
        },
      }
    default:
      return { location: { view: 'design' } }
  }
}

export function parseRoute(path: string): WorkbenchLocation {
  return parseRouteContext(path).location
}

export function routePath(route: WorkbenchLocation, connectorOwnerId?: string): string {
  if (route.flowId == null) return '/'
  const params = new URLSearchParams()
  if (route.view == 'runs') {
    if (route.runSource != null) params.set('source', route.runSource)
    if (route.runId != null) params.set('runId', route.runId)
  }
  const search = params.size == 0 ? '' : `?${params}`
  const prefix = connectorOwnerId == null ? '' : `/team/${encodeURIComponent(connectorOwnerId)}`
  return `${prefix}/flows/${encodeURIComponent(route.flowId)}/${route.view}${search}`
}
