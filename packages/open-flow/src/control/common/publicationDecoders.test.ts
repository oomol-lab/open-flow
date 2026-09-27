import { expect, it } from 'vitest'
import { publication } from './publicationDecoders.ts'

const base = {
  actorId: 'actor',
  closureDigest: 'closure',
  createdAt: '2026-09-28T00:00:00Z',
  engineContract: 'engine',
  flowId: 'flow',
  modelVersion: 2,
  operation: 'publish',
  publicationId: 'publication',
  sharedAccessDigest: 'access',
  revisionDigest: 'digest',
  revisionId: 'revision',
  version: 1,
}

it('decodes an optional Live end snapshot while retaining compatibility with old publications', () => {
  expect(publication(base).liveEnd).toBeUndefined()
  for (const enabled of [true, false]) {
    const liveEnd = { enabled, endedAt: '2026-09-29T00:00:00Z' }
    expect(publication({ ...base, liveEnd }).liveEnd).toEqual(liveEnd)
  }
  for (const liveEnd of [{ enabled: 1, endedAt: 'date' }, { enabled: true }, { endedAt: 'date' }, 'enabled']) {
    expect(() => publication({ ...base, liveEnd })).toThrow()
  }
})
