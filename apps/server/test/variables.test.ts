import { expect, it } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

it('limits each owner independently and preserves empty values, duplicate bindings and unchanged timestamps', () => {
  const database = Database.open(':memory:')
  let now = 1
  const store = new Store(database, () => now++)
  const variables = store.variables
  for (const owner of ['a', 'b'])
    store.flows.createFlow({
      actorId: owner,
      content: '{"modelVersion": 3}',
      createdAt: 1,
      digest: 'digest',
      flowId: `flow-${owner}`,
      idempotencyKey: owner,
      modelVersion: 3,
      name: owner,
      requestDigest: owner,
      revisionId: `revision-${owner}`,
    })
  try {
    for (let index = 0; index < 200; index++) expect(variables.put('a', `KEY_${index}`, 'a').kind).toBe('saved')
    expect(variables.put('a', 'OVER_LIMIT', 'a').kind).toBe('limit-reached')
    const saved = variables.put('b', 'KEY_0', '')
    expect(saved.kind).toBe('saved')
    expect(variables.put('b', 'KEY_0', '')).toEqual(saved)
    expect(variables.put('a', 'KEY_0', 'changed').kind).toBe('saved')
    expect(variables.resolve('flow-a', { token: 'KEY_0' })).toEqual({ token: 'changed' })
    expect(variables.resolve('flow-b', { first: 'KEY_0', second: 'KEY_0' })).toEqual({ first: '', second: '' })
    expect(variables.resolve('flow-b', { missing: 'KEY_1' })).toBeUndefined()
    expect(variables.hasAll('flow-b', ['KEY_0', 'KEY_0'])).toBe(true)
    expect(variables.hasAll('flow-b', ['KEY_1'])).toBe(false)
    expect(variables.delete('a', 'KEY_0')).toBe(true)
    expect(variables.get('b', 'KEY_0')?.value).toBe('')
    expect(variables.put('a', 'OVER_LIMIT', 'a').kind).toBe('saved')
  } finally {
    database.close()
  }
})
