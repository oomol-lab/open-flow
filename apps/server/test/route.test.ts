import { expect, it } from 'vitest'
import { parseRoute, parseRouteContext, routeOwnerForFlow, routePath } from '../browser/route.ts'

it('maps Server paths without a Team segment', () => {
  expect(parseRoute('/')).toEqual({ view: 'design' })
  expect(parseRoute('/flows/main%2Fflow/runs')).toEqual({
    flowId: 'main/flow',
    view: 'runs',
  })
  expect(parseRoute('/teams/example')).toEqual({ view: 'design' })
  expect(parseRoute('/flows/%E0%A4%A/design')).toEqual({ view: 'design' })

  expect(routePath({ view: 'design' })).toBe('/')
  expect(routePath({ flowId: 'main/flow', view: 'publications' })).toBe('/flows/main%2Fflow/publications')
})

it('keeps the Team owner in the host route context', () => {
  const location = { flowId: 'main/flow', view: 'design' as const }
  const path = '/team/acme%2Fengineering/flows/main%2Fflow/design'
  expect(parseRouteContext(path)).toEqual({ connectorOwnerId: 'acme/engineering', location })
  expect(routePath(location, 'acme/engineering')).toBe(path)
  expect(parseRoute(path)).toEqual(location)
})

it('resolves route owners from the target Flow before falling back to the current route', () => {
  const current = { flowId: 'flow-a', view: 'design' as const }
  const bindings = [
    { flowId: 'flow-a', teamId: 'team-a' },
    { flowId: 'flow-b', teamId: 'team-b' },
  ]
  const teams = [
    { id: 'team-a', name: 'Team A' },
    { id: 'team-b', name: 'Team B' },
  ]
  expect(routeOwnerForFlow(current, 'Team A', 'flow-b', bindings, teams)).toBe('Team B')
  expect(routeOwnerForFlow(current, 'Team A', 'flow-a', [], [])).toBe('Team A')
  expect(routeOwnerForFlow(current, 'Team A', 'flow-c', bindings, teams)).toBeUndefined()
})

it.each(['draft', 'live'] as const)('round-trips the %s Run source in search params', (runSource) => {
  const location = { flowId: 'main/flow', view: 'runs' as const, runSource }
  const path = `/flows/main%2Fflow/runs?source=${runSource}`
  expect(routePath(location)).toBe(path)
  expect(parseRoute(path)).toEqual(location)
})

it('ignores unsupported sources and keeps source scoped to Runs', () => {
  expect(parseRoute('/flows/main/runs?source=trigger')).toEqual({ flowId: 'main', view: 'runs' })
  expect(parseRoute('/flows/main/design?source=live')).toEqual({ flowId: 'main', view: 'design' })
  expect(routePath({ flowId: 'main', view: 'publications', runSource: 'live' })).toBe('/flows/main/publications')
})

it.each(['', 'trigger', 'unknown', 'LIVE', '%E0%A4%A'])('treats unrecognized source=%s as absent', (source) => {
  expect(parseRoute(`/flows/main/runs?source=${source}`)).toEqual({ flowId: 'main', view: 'runs' })
})

it('round-trips error handling Run links and scopes the Run filter to Runs', () => {
  const location = { flowId: 'handler/flow', view: 'runs' as const, runId: 'run/id', runSource: 'live' as const }
  expect(parseRoute(routePath(location))).toEqual(location)
  expect(parseRoute('/flows/main/design?runId=ignored')).toEqual({ flowId: 'main', view: 'design' })
})
