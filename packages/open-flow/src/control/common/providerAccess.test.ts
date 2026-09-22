import { expect, it } from 'vitest'
import { parseProviderAccessSource, providerAccessBindingId } from './providerAccess.ts'

it('isolates administrator delegation, default policy, and arbitrary rule IDs', async () => {
  const identity = { connectionId: 'account', providerId: 'github' }
  const sources = [
    { kind: 'admin-delegation' },
    { kind: 'policy', ruleId: null },
    { kind: 'policy', ruleId: 'team-admin' },
    { kind: 'policy', ruleId: 'team-default' },
    { kind: 'policy', ruleId: 'admin-delegation' },
  ] as const
  const ids = await Promise.all(sources.map((source) => providerAccessBindingId('team', { ...identity, source })))
  expect(new Set(ids).size).toBe(sources.length)
  const source = sources[2]
  await expect(providerAccessBindingId('other-team', { ...identity, source })).resolves.not.toBe(ids[2])
  await expect(providerAccessBindingId('team', { ...identity, connectionId: 'other-account', source })).resolves.not.toBe(ids[2])
  await expect(providerAccessBindingId('team', { ...identity, providerId: 'other-provider', source })).resolves.not.toBe(ids[2])
  await expect(providerAccessBindingId('team', { ...identity, source: { ruleId: 'team-admin', kind: 'policy' } })).resolves.toBe(ids[2])
})

it.each([
  undefined,
  {},
  { kind: 'team-default' },
  { kind: 'policy' },
  { kind: 'policy', ruleId: '' },
  { kind: 'admin-delegation', ruleId: 'team-admin' },
  { kind: 'policy', ruleId: null, extra: true },
])('rejects ambiguous or malformed access sources: %j', (source) => {
  expect(() => parseProviderAccessSource(source)).toThrow()
})
