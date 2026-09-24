import { expect, it } from 'vitest'
import { parseRoute, routePath } from '../browser/route.ts'

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
