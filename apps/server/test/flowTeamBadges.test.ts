import { expect, it } from 'vitest'
import { flowTeamBadges } from '../browser/flowTeamBadges.ts'

it('prefers live team names, then remembered names, then team IDs', () => {
  const bindings = [
    { flowId: 'live', teamId: 'one', teamName: 'Old name' },
    { flowId: 'remembered', teamId: 'two', teamName: 'Saved name' },
    { flowId: 'legacy', teamId: 'three' },
  ]
  expect(flowTeamBadges(bindings, [{ id: 'one', name: 'Current name' }])).toEqual({
    live: 'Current name',
    remembered: 'Saved name',
    legacy: 'three',
  })
  expect(flowTeamBadges(bindings, [])).toEqual({
    live: 'Old name',
    remembered: 'Saved name',
    legacy: 'three',
  })
})
